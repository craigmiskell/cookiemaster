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

function handleMessage(message, sender, sendResponse) {
  switch (message.name) {
    case "configChanged":
      loadConfig();
      break;
    //Message passing to work around https://bugzilla.mozilla.org/show_bug.cgi?id=1329304
    // - can't getBackgroundPage() from an incognito window.  Given how (relatively) easy
    // it is to work around this behaviour, it's clearly not a security feature.  It's just annoying
    case "getTabsInfo":
      sendResponse(tabsInfo[message.tabId]);
      break;
    case "getDomains":
      sendResponse(domains);
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

function filterSetCookie(header, requestURL, tabURL, tabId) {
  //console.log("filtersetcookie " + header.name);
  if(header.name.toLowerCase() == 'set-cookie') {
    //console.log("set-cookie for " + requestURL + " on tab with url " + tabURL);

    //Notice if this header is 'deleting' cookies by setting the expiry date; allow that always, because
    // that's what people would expect to happen.  Attributes 'Expires' (a date) or 'Max-Age' (number of seconds).  
    //If there is more than one cookie in the header then *all* must be a delete/expire to succeed in this check.
    // NB: This logs/records nothing; the cookie is to be deleted so requires no visibility in the UI
    var cookies = parseCookies(header);
    var deleteCount = 0;
    var now = new Date();
    for (var cookie of cookies) {
      var expires;
      if(cookie.hasOwnProperty('expires')) {
        expires = parseDate(cookie['expires'])
        //NB: may still be undefined if the expires av is malformed, this is fine
      }
      //Will be false if 'expires' is undefined.
      if(expires <= now) {
        deleteCount += 1;
      } else if (cookie.hasOwnProperty('max-age') && (cookie['max-age'] <= 0)) {
        deleteCount += 1;
      }
    }
    if(deleteCount == cookies.length) {
      //All cookies in the header were a 'delete'; allow it
      return true;
    }

    var rURL = new URL(requestURL);
    var tURL = new URL(tabURL);

    var tabInfo = getTabInfo(tabId);

    if(tURL.hostname != rURL.hostname) {
      // Third party cookie
      switch(config.thirdParty) {
        case ThirdPartyOptions.AllowAll:
          for(var cookie of cookies) {
            var d = cookie['domain'] || rURL.hostname;
            registerCookie(tabInfo['cookieDomainsAllowed'], d, d); 
          }
          tabInfo.updated = Date.now();
          //console.log("Allowing third party cookie; not allowed");
          return true;
        case ThirdPartyOptions.AllowNone:
          for(var cookie of cookies) {
            var d = cookie['domain'] || rURL.hostname;
            registerCookie(tabInfo['cookieDomainsBlocked'], d, d); 
          }
          tabInfo.updated = Date.now();
          //console.log("Blocking third party cookie; not allowed");
          return false;
        case ThirdPartyOptions.AllowIfOtherwiseAllowed:
          // continue on with normal filtering 
          break;
      }
    }

    //NB: We don't care about, and let the browser take care of:
    //  *) The content of the cookie, or in general its validity.
    //  *) _Secure-/_Host- prefixes, or the Secure attribute
    //  *) HttpOnly/SameSite
    //  *) Public suffixes (http://publicsuffix.org/)
    //  *) Path: we filter by hostname; the path is irrelevant

    //console.log("First party cookie for "+ rURL.hostname);
    //Some miscreants (tapad.com for example) send multiple cookies in one header, with line breaks between.
    // Fuck them, and their little dog too.
    // We check each individually, and *all* must be allowed if any are to be (e.g. they could have
    //  different domains, and we have to fail-safe)
    var allow = {};
    var allOK = true; //Assume true; set to false if any aren't allowed
    for (cookie of cookies) {
      var domain = cookie['domain'] || rURL.hostname;
      //console.log("Domain: " + domain);
      var configDomain = domainIsAllowed(config, domain);
      if(configDomain != undefined) {
        allow[domain] = configDomain;
      } else {
        allOK = false;
      }
    }
    if(allOK) {
      var allowedDomains = Object.keys(allow);
      for(var d of allowedDomains) {
        registerCookie(tabInfo['cookieDomainsAllowed'], d, allow[d]); 
      }
      //console.log("Allowing first party cookie for "+domain);
    } else {
      for(var cookie of cookies) {
        var d = cookie['domain'] || rURL.hostname;
        registerCookie(tabInfo['cookieDomainsBlocked'], d, d); 
      }
      //console.log("Blocking first party cookie for "+domain);
    }
    tabInfo.updated = Date.now();
    return allOK
  }
  //Any non-cookie header is left alone 
  return true;
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
//  console.log("headersReceived");
//  console.log(details);
  var tabURL;
  var tabId = details.tabId;
  var tabInfo = getTabInfo(tabId);
  var frameInfo = tabInfo["frameInfo"];
  //console.log("headersReceived");
  //console.log(details.frameId);
  if(details.frameId in frameInfo) {
    tabURL = frameInfo[details.frameId]; 
  } else {
    var tab = await browser.tabs.get(tabId);
    tabURL = tab.url
  }
  var filteredResponseHeaders = details.responseHeaders.filter(function(header) {
    return filterSetCookie(header, details.url, tabURL, tabId)
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
      //console.log("Redirect response from " + details.url + " to " + newLocation);
      tabInfo["frameInfo"][details.frameId] = newLocation
    }
  }

  return {responseHeaders: filteredResponseHeaders};
}

//Records hostnames of requests for a given tab, so we can guess about cookie-change events
async function beforeRequest(details) {
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

  //console.log("Request started for " + details.url)
}

// Catch script-set cookies (that weren't in headers).  Yes, this may have to process (and allow again)
// those that make it through the header check.  *Probably* not a problem, but if performance
// is impacted, we may have to somehow tag the header/cookie with additional info.  
async function cookieChanged(changeInfo) {
  var cookie = changeInfo.cookie;
  if(!changeInfo.removed) {
    //Future enhancement:
    // Where can we get the tab id from?  There doesn't seem to be *any* available
    // way to make this connection.  tabs.getCurrent() returns undefined, can't run a content_script
    // that listens to this event (not available from said context).
    // It's possible this will never be a thing we can do directly, so for now we record what we can
    // See https://bugzilla.mozilla.org/show_bug.cgi?id=1416548
    //var tabInfo = getTabInfo(e.tabId);

    var domain = cookie.domain;
    var configDomain = domainIsAllowed(config, domain);

    //Use the domain which allowed the cookie, if it was allowed, otherwise use the domain of the cookie itself
    var recordDomain = configDomain || domain;
    if(!(recordDomain in domains)) {
      domains[recordDomain] = {}; 
    }
    var domainInfo = domains[recordDomain];
    var action;
    if(configDomain == undefined) {
//      console.log("Blocking cookie-change cookie for "+domain);
      var prefix = cookie.secure ? "https://" : "http://";
      var url = prefix + cookie.domain + cookie.path;
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
      //console.log("Allowing cookie-change cookie for "+domain);
      action = 'allowed';
    }
    if(!(action in domainInfo)) {
      domainInfo[action] = {};
    }
    domainInfo[action][domain] = Date.now();
    domains.updated = Date.now();
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
//  console.log("Loadconfig");
  config = await getConfig(); 
}

//before and completed navigation events are used to capture + record the URL being
// loaded before it becomes available on the tab, so we can do the right thing with
// early cookie blocking.  And reset per-tab-page-load cookie logs
function beforeNavigate(details) {
  //console.log("Before navigate " + details.url);
  //console.log(details.frameId);
  var tabId = details.tabId;
  if(details.frameId == 0) {
    // 0 == the main frame, i.e. new URL for the tab, not just a sub-frame, so it's properly time to
    // clean out information (equiv to the tab being closed/removed, as it happens)
    tabRemoved(tabId);
  }
  var tabInfo = getTabInfo(tabId);
  tabInfo["frameInfo"][details.frameId] = details.url;
}
function navigationCompleted(details) {
  //Don't create the tabinfo if it doesn't already exist
  if(details.tabId in tabsInfo) {
    var tabInfo = getTabInfo(details.tabId);
    delete tabInfo["frameInfo"][details.frameId];
  }
  //console.log("Navigation completed " + details.url)
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
    //console.log(tabsInfo[tabId]);
    //removeTabIdFromDomains(tabId);
    delete tabsInfo[tabId];
  }
}

//console.log("Loading CookieMaster extension @ " + Date());
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
