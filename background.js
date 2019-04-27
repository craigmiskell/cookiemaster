/*
  Copyright 2017 Craig Miskell

  This file is part of CookieMaster, a Firefox Web Extension
  CookieMaster is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  CookieMaster is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU General Public License for more details.

  You should have received a copy of the GNU General Public License
  along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

//All uses of logging in the background script must go direct to logger; sendMessage will not
// send a message within a context/frame, so we can't sendMessage from here and
// have it received by logger.  Was unable to find any simple way to spin off logger
// into its own context sufficient to make this work
let logger = new Logger();

function handleMessage(message, sender, sendResponse) {
  //TODO: Convert to returning a Promise; sendResponse is going away
  // (https://github.com/mozilla/webextension-polyfill/issues/16#issuecomment-296693219)
  // See https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/onMessage
  switch (message.type) {
    case MessageTypes.ConfigChanged:
      loadConfig();
      break;
    //Message passing to work around https://bugzilla.mozilla.org/show_bug.cgi?id=1329304
    // - can't getBackgroundPage() from an incognito window.  Given how (relatively) easy
    // it is to work around this behaviour, it's clearly not a security feature.  It's just annoying
    case MessageTypes.GetTabsInfo:
      sendResponse(tabsInfo[message.tabId]);
      break;
    case MessageTypes.GetDomains:
      sendResponse(domains);
      break;
    case MessageTypes.GetLogLevel:
      sendResponse(logger.level);
      break;
    case MessageTypes.SetLogLevel:
      logger.level = message.level;
      break;
  }
}

function parseCookies(setCookieHeader) {
  var result = [];
  var lines = setCookieHeader.value.split("\n");
  for(var i = 0; i < lines.length; i++) {
    result.push(cookieparse(lines[i]));
  }
  return result;
}

function registerCookie(cookiesRecord, cookieDomain, configDomain) {
  if(configDomain in cookiesRecord) {
    cookiesRecord[configDomain][cookieDomain] = Date.now();
  } else {
    //[cookieDomain] to use the contents of the var, not the literal text 'cookieDomain', as the key
    // c.f. 'Computed Property Names' https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Object_initializer
    cookiesRecord[configDomain] = { [cookieDomain]: Date.now() };
  }
}

function processHeader(header, requestURL, tabURL, tabId) {
  if(header.name.toLowerCase() == 'set-cookie') {
    logger.log(LogLevel.DEBUG, "set-cookie header for " + requestURL);

    //Notice if this header is 'deleting' cookies by setting the expiry date; allow that always, because
    // that's what people would expect to happen.  Attributes 'Expires' (a date) or 'Max-Age' (number of seconds).
    //If there is more than one cookie in the header then *all* must be a delete/expire to succeed in this check.
    // NB: This logs/records nothing; the cookie is to be deleted so requires no visibility in the UI
    var cookies = parseCookies(header);
    var deleteCount = 0;
    var now = new Date();
    for (var cookie of cookies) {
      var expires;
      //Elide the value of the cookie for logging; it may be sensitive
      let logCookie = Object.assign({}, cookie);
      logCookie.value = 'REDACTED';
      logger.log(LogLevel.DEBUG, "Checking cookie: " + JSON.stringify(logCookie));
      if(cookie.hasOwnProperty('expires')) {
        //NB: will result in 'undefined' if the expires av is malformed; this is fine.
        expires = parseDate(cookie['expires'])
        cookie['expires'] = expires; //Save the parsed 'Date' object, for later potential reserializing
      }
      logger.log(LogLevel.DEBUG, "Expires: " + expires);
      //Will be false if 'expires' is undefined.
      if(expires <= now) {
        deleteCount += 1;
      } else if (cookie.hasOwnProperty('max-age') && (cookie['max-age'] <= 0)) {
        deleteCount += 1;
      }
      logger.log(LogLevel.DEBUG, "Delete count " +deleteCount);
    }
    if(deleteCount == cookies.length) {
      //All cookies in the header were a 'delete'; allow this header
      logger.log(LogLevel.DEBUG, "All cookies were a delete; allow");
      return header;
    }

    var rURL = new URL(requestURL);
    var tURL = new URL(tabURL);

    var tabInfo = getTabInfo(tabId);

    if(tURL.hostname != rURL.hostname) {
      logger.log(LogLevel.DEBUG, "third party cookie: "+tURL.hostname+" vs "+rURL.hostname)
      // Third party cookie
      switch(config.thirdParty) {
        case ThirdPartyOptions.AllowAll:
          for(var cookie of cookies) {
            var d = cookie['domain'] || rURL.hostname;
            registerCookie(tabInfo['cookieDomainsAllowed'], d, d);
          }
          tabInfo.updated = Date.now();
          logger.log(LogLevel.INFO, "Allowing third party cookie for "+d+"; allow all");
          return header;
        case ThirdPartyOptions.AllowNone:
          for(var cookie of cookies) {
            var d = cookie['domain'] || rURL.hostname;
            registerCookie(tabInfo['cookieDomainsBlocked'], d, d);
          }
          tabInfo.updated = Date.now();
          logger.log(LogLevel.INFO, "Blocking third party cookie for "+d+"; not allowed");
          return undefined;
        case ThirdPartyOptions.AllowIfOtherwiseAllowed:
          // continue on with normal processing
          break;
      }
    }

    //NB: We don't care about, and let the browser take care of:
    //  *) The content of the cookie, or in general its validity.
    //  *) _Secure-/_Host- prefixes, or the Secure attribute
    //  *) HttpOnly/SameSite
    //  *) Public suffixes (http://publicsuffix.org/)
    //  *) Path: we filter by hostname; the path is irrelevant

    logger.log(LogLevel.INFO, "Checking first party cookie for "+ rURL.hostname);
    //Some miscreants (tapad.com for example) send multiple cookies in one header, with line breaks between.
    // We check each individually, and *all* must be allowed if any are to be (e.g. they could have
    //  different domains, and we have to fail-safe)
    var allow = {};
    var allOK = true; //Assume true; set to false if any aren't allowed
    var cookieLines = [];

    for (cookie of cookies) {
      var domain = cookie['domain'] || rURL.hostname;
      logger.log(LogLevel.DEBUG, "Domain: " + domain);
      var configDomain = config.domainIsAllowed(domain);
      if(configDomain != undefined) {
        allow[domain] = configDomain;
        if(configDomain.settings.allowType == AllowTypes.Session) {
          logger.log(LogLevel.INFO, "Allow session cookies only; removing time fields (if any)");
          delete cookie['expires'];
          delete cookie['max-age'];
        }
        //It would be nicer to not have to reserialize cookies we aren't
        // modifying, but because of multi-line cookies (each potentially
        // different domains thus AllowTypes), doing so would basically
        // be a whole bunch of conditional cases, which is ugly and a chance
        // for even weirder bugs
        //Catch and ignore any serialization failures; if the cookie
        // is that far malformed, it doesn't deserve to be passed through
        try {
          cookieLines.push(serialize(cookie.name, cookie.value, cookie));
        } catch(e) {
          console.error(e);
        }
      } else {
        allOK = false;
      }
    }
    //Replace the header with our re-serialized/sanitized cookies
    header = {
      name: "Set-Cookie",
      value: cookieLines.join("\n"),
    };

    tabInfo.updated = Date.now();
    if(allOK) {
      var allowedDomains = Object.keys(allow);
      for(var d of allowedDomains) {
        registerCookie(tabInfo['cookieDomainsAllowed'], d, allow[d].domain);
      }
      logger.log(LogLevel.INFO, "Allowing first party cookie(s) for "+domain);

      return header;
    } else {
      for(var cookie of cookies) {
        var d = cookie['domain'] || rURL.hostname;
        registerCookie(tabInfo['cookieDomainsBlocked'], d, d);
      }
      logger.log(LogLevel.INFO, "Blocking first party cookie for "+domain);
      return undefined;
    }
  }
  //Any non-cookie header is left alone
  return header;
}

function getNewLocation(headers) {
  var locationHeader = headers.find(function(header) {
    return (header.name.toLowerCase() == 'location')
  });
  if (locationHeader) {
    return locationHeader.value;
  }
  return undefined;
}

async function headersReceived(details) {
  try {
    //Leave these as optional console.log for now; they're super detailed
    // and may contain sensitive info.  Maybe only report at a highest of levels
    // and never send to dev?
    //console.log("headersReceived");
    //console.log(details);
    var tabURL;
    var tabId = details.tabId;
    var tabInfo = getTabInfo(tabId);
    var frameInfo = tabInfo["frameInfo"];
    logger.log(LogLevel.DEBUG, "headersReceived in frame "+ details.frameId);
    if(details.frameId in frameInfo) {
      tabURL = frameInfo[details.frameId];
      logger.log(LogLevel.DEBUG, "Got tabURL "+tabURL +" from frameInfo with frameId("+details.frameId+")");
    } else {
      var tab = await browser.tabs.get(tabId);
      tabURL = tab.url
      logger.log(LogLevel.DEBUG, "Got tabURL from the tab itself, being "+tabURL);
    }
    var filteredResponseHeaders = details.responseHeaders.map(function(header) {
      return processHeader(header, details.url, tabURL, tabId)
    }).filter(function(header) {
      return header != undefined;
    });

    // Having filtered cookies based on *this* request URL, detect redirects (301 + 302)
    // in the primary frame (frameId 0).  If we see one, we need to update the
    // primary URL for this tab, so we get first/third-party handling correct in later
    // responses, because beforeNavigation doesn't get called again for such redirects
    // This is annoying, and possibly fragile
    if(details.frameId == 0) {
      // 0 == the main frame,
      if ([301,302,303,307,308].includes(details.statusCode)) {
        //Redirect type responses; the Location header will be the new URL
        var newLocation = getNewLocation(details.responseHeaders);
        //The newLocation might be relative, so always use URL to resolve it with
        // the optional 'base' arg.  Saves hassles later, I promise
        var baseURL = new URL(details.url);
        newLocation = new URL(newLocation, baseURL.origin).href;
        logger.log(LogLevel.DEBUG, "Redirect response from " + details.url + " to " + newLocation);
        tabInfo["frameInfo"][details.frameId] = newLocation
      }
    }
    return {responseHeaders: filteredResponseHeaders};
  } catch(e) {
    logger.log(LogLevel.ERROR, e);
    //Return the original; it's not ideal, but it'll do if things have gone horribly wrong
    return {responseHeaders: details.responseHeaders }
  }
}

//Records hostnames of requests for a given tab, so we can guess about cookie-change events
async function beforeRequest(details) {
  try {
    var tabId = details.tabId;
    var url = new URL(details.url);
    var hostname = url.hostname;

    //Record it in the domains list
    if(!(hostname in domains)) {
      domains[hostname] = {};
    }
    //Record directly against the tabInfo as well
    var tabInfo = getTabInfo(tabId);
    tabInfo.domainsFetched[hostname] = Date.now();
    tabInfo.updated = Date.now();

    logger.log(LogLevel.DEBUG, "Request started for " + details.url)
  } catch(e) {
    logger.log(LogLevel.ERROR, e);
  }
}

// Catch script-set cookies (that weren't in headers).  Yes, this may have to process (and allow again)
// those that make it through the header check.  *Probably* not a problem, but if performance
// is impacted, we may have to somehow tag the header/cookie with additional info.
async function cookieChanged(changeInfo) {
  try {
    var cookie = changeInfo.cookie;
    if(changeInfo.removed) {
      return; //Let it be removed
    }
    //Future enhancement:
    // Where can we get the tab id from?  There doesn't seem to be *any* available
    // way to make this connection.  tabs.getCurrent() returns undefined, can't run a content_script
    // that listens to this event (not available from said context).
    // It's possible this will never be a thing we can do directly, so for now we record what we can
    // See https://bugzilla.mozilla.org/show_bug.cgi?id=1416548
    //var tabInfo = getTabInfo(e.tabId);

    var domain = cookie.domain;
    var configDomain = config.domainIsAllowed(domain);

    //Use the domain which allowed the cookie, if it was allowed, otherwise use the domain of the cookie itself
    var recordDomain = (configDomain && configDomain.domain) || domain;
    if(!(recordDomain in domains)) {
      domains[recordDomain] = {};
    }
    var domainInfo = domains[recordDomain];
    var action;
    var prefix = cookie.secure ? "https://" : "http://";
    //Strip leading . off the domain, otherwise the URL is malformed and it just Won't Work
    var d = cookie.domain;
    if (d.startsWith(".")) {
      d = d.slice(1);
    }
    var url = prefix + d + cookie.path;
    if(configDomain == undefined) {
      logger.log(LogLevel.INFO, "Blocking cookie-change cookie for "+domain);
      //Don't care about the result of deleting the cookie, because:
      // 1) Success: we don't have a tabId to record the successful deletion against
      // 2) Failure happens (race condition: set/set/delete/delete), and doesn't matter
      browser.cookies.remove({
        url: url,
        name: cookie.name,
        storeId: cookie.storeId,
        firstPartyDomain: cookie.firstPartyDomain
      });
      action = 'blocked';
    } else {
      logger.log(LogLevel.INFO, "Allowing cookie-change cookie for "+domain);
      if(configDomain.settings.allowType == AllowTypes.Session && cookie.hasOwnProperty("expirationDate")) {
        logger.log(LogLevel.INFO, "Only session cookies allowed; removing expirationDate");
        delete cookie['expirationDate']
        //There are some other properties in the supplied cookie which cookies.set will reject
        // so we have to delete them.  Good game, Firefox.
        delete cookie['hostOnly'];
        delete cookie['session'];
        //Oddly, URL is not included in the cookie we are given; we use the one we constructed above
        cookie.url = url;

        //As for delete, we can't really care about the result here.  This is slightly less
        // happy path, but there's still nothing we can do about the result; certain egregious
        // failures will result in an exception, which we catch separately.
        browser.cookies.set(cookie);
      }
      action = 'allowed';
    }
    if(!(action in domainInfo)) {
      domainInfo[action] = {};
    }
    domainInfo[action][domain] = Date.now();
    domains.updated = Date.now();
  } catch(e) {
    //Catch and log the error so that we can potentially see it, rather than a silent fail
    // from an internal callback
    logger.log(LogLevel.ERROR, e);
  }
}

var config;
//A record of tab information, from webNavigation (for early loading details)
// and for keeping track of cookies loaded/blocked per tab (for the UI)
var tabsInfo= {};

//A record of domains that we've loaded anything from.  Key is the domain of the cookie domain, value is
// an object with keys:
//  allowed: A map/object of the domains of cookies that were allowed by this domain being in the configured allow list.
//  blocked: A map/object of the domains blocked by this domain name (will be one-to-one match; blocks don't
//           happen because of specific config
//  For both allowed + blocked, the keys in the nested object are the domains, the value is the Date.now()
//   timestamp when this cookie was last set (used by the popup to filter out old cookie set attempts)
//
// In the tabInfo data structure we keep a list of domains seen (domainsFetched), so we can then look into
// this list when the UI wants to know what domains cookies have been blocked/allowed on a given tab

// The UI looks at the tabInfo for the current tab to get a list of domains, then checks
//  this dictionary (with suffix-matching) to see if there's been cookie behaviour
//  If so, displays it; it's not entirely accurate, because we can't be sure on which tab, of possibly many
//  tabs that this domain is loaded from, a cookie was *actually* allowed/blocked.  Until WebExtensions
//  gives us more info on the cookieChanged, this is the best we can do
var domains = {
  updated: 0,
}

async function loadConfig() {
  logger.log(LogLevel.DEBUG, "Load Config");
  config = await Config.get();
}

//before and completed navigation events are used to capture + record the URL being
// loaded before it becomes available on the tab, so we can do the right thing with
// early cookie blocking.  And reset per-tab-page-load cookie logs
function beforeNavigate(details) {
  try {
    logger.log(LogLevel.DEBUG, "Before navigate " + details.url + " in frame " +details.frameId);
    var tabId = details.tabId;
    if(details.frameId == 0) {
      // 0 == the main frame, i.e. new URL for the tab, not just a sub-frame, so it's properly time to
      // clean out information (equiv to the tab being closed/removed, as it happens)
      tabRemoved(tabId);
    }
    var tabInfo = getTabInfo(tabId);
    tabInfo["frameInfo"][details.frameId] = details.url;
  } catch(e) {
    logger.log(LogLevel.ERROR, e);
  }
}

function navigationCompleted(details) {
  try {
    //Don't create the tabinfo if it doesn't already exist
    if(details.tabId in tabsInfo) {
      var tabInfo = getTabInfo(details.tabId);
      delete tabInfo["frameInfo"][details.frameId];
    }
    logger.log(LogLevel.DEBUG, "Navigation completed " + details.url)
  } catch(e) {
    logger.log(LogLevel.ERROR, e);
  }
}

function getTabInfo(tabId) {
  if(!(tabId in tabsInfo)) {
    tabsInfo[tabId] = {
      cookieDomainsAllowed: {},
      cookieDomainsBlocked: {},
      frameInfo: {}, //Keeps info, by frameId (sub frames of the tab)
      domainsFetched: {},
      created: Date.now(), //When this tabInfo was created; used for filtering 'other' cookies set by code
      updated: Date.now(), //When this tabInfo last had some cookie or domain info updated.
    }
  }
  return tabsInfo[tabId];

}
//Tidyup; delete metadata about tabs that have been closed
function tabRemoved(tabId) {
  if(tabsInfo[tabId]) {
    logger.log(LogLevel.DEBUG, "Deleting info for tabId "+ tabId);
    delete tabsInfo[tabId];
  }
}

logger.log(LogLevel.INFO, "Loading CookieMaster extension @ " + Date());
loadConfig();

browser.webRequest.onHeadersReceived.addListener(
  headersReceived,
  {
    urls: [
      "http://*/*",
      "https://*/*"
    ]
  },
  ["blocking", "responseHeaders"]
);
browser.webRequest.onBeforeRequest.addListener(
  beforeRequest,
  {
    urls: [
      "http://*/*",
      "https://*/*"
    ]
  }
);

browser.cookies.onChanged.addListener(cookieChanged);
browser.webNavigation.onBeforeNavigate.addListener(beforeNavigate);
browser.webNavigation.onCompleted.addListener(navigationCompleted);
browser.tabs.onRemoved.addListener(tabRemoved);
browser.runtime.onMessage.addListener(handleMessage);
