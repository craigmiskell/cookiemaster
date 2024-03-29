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
  switch (message.type) {
    case MessageTypes.ConfigChanged:
      loadConfig();
      notifyAllTabsConfigChange();
      break;
    //Message passing to work around https://bugzilla.mozilla.org/show_bug.cgi?id=1329304
    // - can't getBackgroundPage() from an incognito window.  Given how (relatively) easy
    // it is to work around this behaviour, it's clearly not a security feature.  It's just annoying
    case MessageTypes.GetTabsInfo:
      sendResponse(tabsInfo[message.tabId]);
      break;
    case MessageTypes.ScriptedCookieEvent:
      scriptedCookieEvent(message.domain, message.configDomain, sender.tab.id, sender.frameId, message.allowed);
      break;
    case MessageTypes.GetLogLevel:
      sendResponse(logger.level);
      break;
    case MessageTypes.SetLogLevel:
      logger.level = message.level;
      break;
    case MessageTypes.ClearLogs:
      logger.clearLogs();
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

// NB: A bit dodgy, given the allowed/blocked top level keys are frame ids
// but it's actually accurate (because they are created as needed, so
// presence/count is all the matters. DO NOT treat .size as a count of
// cookies, *ever*
function _calculateState(allowed, blocked) {
  if (allowed.size > 0) {
    if (blocked.size > 0) {
      return "mixed";
    } else {
      return "allowed";
    }
  }
  //None were allowed; may be simply 'blocked'
  if(blocked.size > 0) {
    return "blocked";
  }
  return "none";
}

function updateBrowserActionIcon(tabId) {
  if(tabId == -1) {
    // Occasionally get a malformed tabId (maybe only in debugging mode).
    return;
  }
   var tabInfo = getTabInfo(tabId);
   logger.debug("Update browser action icon:"+tabInfo.allowedFirstPartyDomains.size+":"+tabInfo.blockedFirstPartyDomains.size+":"
               +tabInfo.allowedThirdPartyDomains.size+":"+tabInfo.blockedThirdPartyDomains.size);
   var firstPartyState = _calculateState(
     tabInfo.allowedFirstPartyDomains,
     tabInfo.blockedFirstPartyDomains
   );
   var thirdPartyState = _calculateState(
     tabInfo.allowedThirdPartyDomains,
     tabInfo.blockedThirdPartyDomains
   );

   var path = "icons/cookies-"+firstPartyState+"-first-"+thirdPartyState+"-third-32.png";
   logger.debug("Setting browser icon path:"+ path);
   tabInfo.browserActionIcon = path;
   browser.browserAction.setIcon({
     path: path,
     tabId: tabId
   });
}

function tabUpdated(tabId, changeInfo, tabs) {
  // Setting the icon in updateBrowserActionIcon sometimes happens too soon
  // e.g. when cookies are only set in headers, and the icon is reset when
  // the tab completes loading.
  // https://stackoverflow.com/questions/12710061/why-does-a-browser-actions-default-icon-reapper-after-a-custom-icon-was-applied
  // describes this.  This is *not* clear in the documentation.
  // So we just force it here, on complete (which should be after it has been
  // reset to any base state again)
  if(changeInfo.status == "complete") {
    var tabInfo = getTabInfo(tabId);
    if(tabInfo.browserActionIcon) {
      browser.browserAction.setIcon({
        path: tabInfo.browserActionIcon,
        tabId: tabId
      });
    }
  }
}

// Basically https://developer.mozilla.org/en-US/docs/Mozilla/Tech/XPCOM/Reference/Interface/mozIThirdPartyUtil#isThirdPartyURI()
// I.e. is first party if the base domains (first domain below the public suffix) are the same, otherwise third party.
function isThirdPartyRequest(tabHostname, requestHostname, requestId) {
  var tab = psl.parse(tabHostname);
  var request = psl.parse(requestHostname);
  logger.debug("isThirdPartyRequest: tab: "+tab.domain+", request: "+request.domain, requestId);
  return tab.domain != request.domain;
}

// Checks the header, in the context of all the other parameters, and returns
// true to retain the header, or false to filter it out.
function shouldFilterHeader(header, requestURL, tabURL, tabId, frameId, requestId) {
  logger.trace("shouldFilterHeader " + header.name + " for "+requestURL +" on "+ tabURL, requestId);
  if(header.name.toLowerCase() == 'set-cookie') {
    logger.debug("set-cookie for " + requestURL + " on tab with url " + tabURL, requestId);

    //Notice if this header is 'deleting' cookies by setting the expiry date; allow that always, because
    // that's what people would expect to happen.  Attributes 'Expires' (a date) or 'Max-Age' (number of seconds).
    //If there is more than one cookie in the header then *all* must be a delete/expire to succeed in this check.
    // NB: This logs/records nothing; the cookie is to be deleted so requires no visibility in the UI
    var cookies = parseCookies(header);
    var deleteCount = 0;
    var now = new Date();
    for (var cookie of cookies) {
      if(cookieIsBeingDeleted(cookie, now)) {
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

    var isThirdParty = isThirdPartyRequest(tURL.hostname, rURL.hostname, requestId);
    if (isThirdParty) {
      switch(config.thirdParty) {
        case ThirdPartyOptions.AllowAll:
          for(var cookie of cookies) {
            var d = cookie['domain'] || rURL.hostname;
            tabInfo.registerAllowedThirdPartyCookie(d, d, frameId);
            logger.info("Allowing third party cookie for domain <b>"+ d +"</b> in header of request on "+tURL.hostname, requestId);
          }
          updateBrowserActionIcon(tabId);
          tabInfo.markUpdated();
          return true;
        case ThirdPartyOptions.AllowNone:
          for(var cookie of cookies) {
            var d = cookie['domain'] || rURL.hostname;
            logger.info("Blocking third party cookie for domain <b>"+ d +"</b> in header of request on "+tURL.hostname, requestId);
            tabInfo.registerBlockedThirdPartyCookie(d, frameId);
          }
          updateBrowserActionIcon(tabId);
          tabInfo.markUpdated();
          return false;
        case ThirdPartyOptions.AllowIfOtherwiseAllowed:
          // continue on with normal filtering
          break;
      }
    }

    //First party cookie, *OR* third party cookie that is 'allowed if otherwise allowed'.
    //DO NOT ASSUME IT IS ALWAYS FIRST PARTY

    //NB: We don't care about, and let the browser take care of:
    //  *) The content of the cookie, or in general its validity.
    //  *) _Secure-/_Host- prefixes, or the Secure attribute
    //  *) HttpOnly/SameSite
    //  *) Public suffixes (http://publicsuffix.org/)
    //  *) Path: we filter by hostname; the path is irrelevant

    logger.debug("First party cookie for "+ rURL.hostname, requestId);
    //Some miscreants (tapad.com for example) send multiple cookies in one header, with line breaks between.
    // We check each individually, and *all* must be allowed if any are to be (e.g. they could have
    //  different domains, and we have to fail-safe)
    var allowBecause = {};
    var allOK = true; //Assume true; set to false if any aren't allowed
    for (cookie of cookies) {
      var domain = cookie['domain'] || rURL.hostname;
      var configDomain = domainIsAllowed(config, domain);
      if(configDomain != undefined) {
        allowBecause[domain] = configDomain;
      } else {
        logger.info("Setting allOK to false  because <b>"+domain+"</b> was not allowed", requestId)
        allOK = false;
      }
    }
    if(allOK) {
      var allowedDomains = Object.keys(allowBecause);
      for(var d of allowedDomains) {
        isThirdParty ?
          tabInfo.registerAllowedThirdPartyCookie(d, allowBecause[d], frameId) :
          tabInfo.registerAllowedFirstPartyCookie(d, allowBecause[d], frameId)
      }
      logger.info("Allowing "+(isThirdParty?"third":"first")+" party cookie in header for <b>"+domain+"</b>", requestId);

    } else {
      for(var cookie of cookies) {
        var d = cookie['domain'] || rURL.hostname;
        isThirdParty ?
          tabInfo.registerBlockedThirdPartyCookie(d, frameId) :
          tabInfo.registerBlockedFirstPartyCookie(d, frameId)
      }
      logger.info("Blocking "+(isThirdParty?"third":"first")+" party cookie in header for <b>"+domain+"</b>", requestId)
    }
    tabInfo.markUpdated();
    updateBrowserActionIcon(tabId);
    return allOK
  }
  //Any non-cookie header is left alone
  return true;
}

// A dirty hack to avoid *unnecessarily* making processHeader an async function
// and thus having to Promise.all() the results in headersReceived, when all
// we care about is getting this value *once*, when the only reason that
// needs to be async is because the crypto hashing call is f%@king async.
// Set with an await call in headersReceived then used
// by processHeader.  This is slightly ugly and impure in pursuit of not having
// IMO even worse async-ugly.  I don't care; Fight me.
var localWindowContextContentScriptSHA256;

var asciiWhitespaceRegexp = RegExp('[\t\n\f\r ]+');
var shaSourceRegexp = RegExp("'sha(256|384|512)-");

function addHashIfNecessary(directive) {
  var hasUnsafeInline = directive.includes("unsafe-inline");
  var hasNonceOrHash = directive.includes("'nonce-") || shaSourceRegexp.test(directive);
  // We should not add our hash if there's unsafe-inline
  // Doing so would cause unsafe-inline to be ignored, and that would break
  // whatever the website owner was trying to allow (however dangerously)
  // However, if there is unsafe-inline *and* some other nonce or hash
  // directive then the browser will ignore unsafe-inline, in which case
  // we *must* add our hash.
  if(!hasUnsafeInline || hasNonceOrHash) {
    logger.debug("Got local hash:"+localWindowContextContentScriptSHA256);
    return directive + " 'sha256-" + localWindowContextContentScriptSHA256+"'"
  }
  logger.debug("Did not have unsafe-inline ("+hasUnsafeInline+"), or did and had no hash/nonce: "+hasNonceOrHash);
  return undefined;
}

// Inspect and modify the header if it needs to be modified (for any reason,
// e.g. CSP).  Returns either the original header, a header to *replace*
// the original header, or null to remove the header entirely (nb: we don't
// actually return null in any cases yet, but I wrote that initially because
// I thought we might.  So now that it can... eh, why remove it?)
function processHeader(header) {
  if(header.name.toLowerCase() == 'content-security-policy') {
    logger.debug("Found content-security-policy:"+header.value);
    var directives = header.value.split(";")
    var scriptSrcElemDirectiveIndex = -1;
    var defaultSrcDirectiveIndex = -1;
    var modified = false
    for (var i=0; i < directives.length; i++) {
      var directive = directives[i].trim();
      // Definition of whitespace: https://infra.spec.whatwg.org/#ascii-whitespace
      var bits = directive.split(asciiWhitespaceRegexp);
      var directiveName = bits[0];
      if(directiveName.toLowerCase() == "script-src" || directiveName.toLowerCase() == "script-src-elem") {
        var result = addHashIfNecessary(directives[i]);
        if(result) {
          directives[i] = result;
          modified = true;
        }
      } else if (directiveName.toLowerCase() == "default-src") {
        // This is just a marker for later (we may not yet know if this is
        // relevant)
        defaultSrcDirectiveIndex = i;
      }
    }
    if(!modified && (defaultSrcDirectiveIndex != -1)) {
      //There were no script-specific directives, but there is a default-src
      // so we need to add our hash to default-src.
      logger.debug("There is a default-src but no script-src");
      var result = addHashIfNecessary(directives[defaultSrcDirectiveIndex]);
      if(result) {
        logger.debug("Adding hash to default-src");
        directives[defaultSrcDirectiveIndex] = result;
        modified = true;
      } else {
        logger.debug("Not adding hash to default-src because of other directives");
      }
    }

    if(modified) {
      header.value = directives.join(";");
    } else {
      logger.debug("Did not modify CSP");
    }
  }
  return header;
}

// Helper for .filter on an array, to emulate Ruby compact (remove nulls)
function _compact(item) {
  return item != null;
}

async function headersReceived(details) {
  try {
    // Do not log these using the logger; they're too risky security wise.
    // This is true debug-level only, for rare and occasional use.
    // console.log("headersReceived");
    // console.log(details);
    var tabId = details.tabId;
    var tabInfo = getTabInfo(tabId);

    var tabURL = details.originUrl;
    var isFrame = ((details.type == "main_frame") || (details.type == "sub_frame"))
    if(isFrame) {
      //When the src of a frame is responding, originUrl will be null or the
      // parent frame's url and the thing we want is the actual url of the request.
      tabURL = details.url;
    }
    logger.trace("Headers received for "+details.url+" on "+tabURL , details.requestId);

    var filteredResponseHeaders = details.responseHeaders.filter(function(header) {
      return shouldFilterHeader(header, details.url, tabURL, tabId, details.frameId, details.requestId);
    });

    // See comment on the variable definition; yes, this is bad.  But the
    // alternative is worse IMO.
    localWindowContextContentScriptSHA256 = await getWindowContextContentScriptSHA256()
    var processedHeaders = filteredResponseHeaders
      .map(processHeader)
      .filter(_compact);

    return {responseHeaders: processedHeaders};
  } catch(e) {
    logger.error(e, details.requestId);
    //Return the original; it's not ideal, but it'll do if things have gone horribly wrong
    return {responseHeaders: details.responseHeaders }

  }
}

var cookieDateParser = new CookieDateParser();
// Inspects the expires and max-age attribute values of the cookie
// and returns true if either of those are set in a way that means the cookie
// should be deleted (not set)
function cookieIsBeingDeleted(cookie, date = new Date()) {
  var expires;
  if(cookie.hasOwnProperty('expires')) {
    expires = cookieDateParser.parseDate(cookie['expires'])
    //NB: may still be undefined if the expires av is malformed, this is fine
  }
  //Will be false if 'expires' is undefined.
  if(expires <= date) {
    return true
  } else if (cookie.hasOwnProperty('max-age') && (cookie['max-age'] <= 0)) {
    return true;
  }
  return false;
}

function scriptedCookieEvent(domain, configDomain, tabId, frameId, allowed) {
  try {
    var tabInfo = getTabInfo(tabId);
    if(allowed) {
      tabInfo.registerAllowedFirstPartyCookie(domain, configDomain, frameId);
    } else {
      tabInfo.registerBlockedFirstPartyCookie(domain, frameId);
    }
    tabInfo.markUpdated();
    updateBrowserActionIcon(tabId);
  } catch (e) {
    logger.error(e);
  }
}

// Catch script-set cookies (that weren't in headers, and weren't caught by
// our content-script capturing (e.g. if CSP prevented it)
// This is a last-ditch effort, and can only allow/block; it used to *attempt*
// to show the activity against the tab, but frankly that was awful and guessy
// and not reliable and I cannot in good conscience keep doing that.
// See https://bugzilla.mozilla.org/show_bug.cgi?id=1416548
async function cookieChanged(changeInfo) {
  var cookie = changeInfo.cookie;
  if(!changeInfo.removed) {
    var domain = cookie.domain;
    if(domainIsAllowed(config, domain) == undefined) {
      logger.info("Blocking cookie-change cookie for <b>"+domain + "</b> in catch-all event");
      var prefix = cookie.secure ? "https://" : "http://";
      var url = prefix + domain + cookie.path;
      browser.cookies.remove({
        url: url,
        name: cookie.name,
        storeId: cookie.storeId,
        firstPartyDomain: cookie.firstPartyDomain
      });
    } else {
      logger.info("Allowing cookie-change cookie for <b>"+domain + "</b> in catch-all event");
    }
   }
 }


var config;
//A record of tab information, from webNavigation (for early loading details)
// and for keeping track of cookies loaded/blocked per tab (for the UI)
var tabsInfo= {};

async function loadConfig() {
  logger.info("Background script - load config");
  config = await getConfig();
}

function beforeNavigate(details) {
  let correlationId = details.windowId+"."+details.tabId+"."+details.frameId;
  try {
    logger.debug("Before navigate ("+details.frameId+"): " + details.url, correlationId);
    if(details.frameId == 0) {
      logger.debug("beforeNavigate with frameId 0; clearing tabInfo", correlationId);
      // 0 == the main frame, i.e. new URL for the tab, not just a sub-frame, so
      // it's time to clean out the stored info for that tab)
      var tabId = details.tabId;
      clearTabInfo(tabId);
    }
  } catch(e) {
    logger.error(e, correlationId);
  }
}

function getTabInfo(tabId) {
  if(!(tabId in tabsInfo)) {
    tabsInfo[tabId] = new TabInfo();
  }
  return tabsInfo[tabId];
}

//Tidyup; delete metadata about tabs that have been closed
function tabRemoved(tabId) {
  clearTabInfo(tabId);
}

function clearTabInfo(tabId) {
  if(tabsInfo[tabId]) {
    delete tabsInfo[tabId];
  }
}

async function notifyAllTabsConfigChange() {
  // NB: even with windowTypes, some tabs will still not be entirely 'normal'
  // e.g. about:* and so on, but we try to eliminate the really abnormal ones
  // Pages without the content-script (blacklisted ones) will generate an error
  // in the console: "Error: Could not establish connection. Receiving end does not exist."
  // This is not an exception so cannot be caught.  The only alternative
  // is to have the content script *register* each tab when it loads.  But
  // that's a bit naff, to eliminate some harmless errors in the console.
  try {
    var windows = await browser.windows.getAll({
      "populate": true,
      "windowTypes": ["normal"]
    });
    for(var window of windows) {
      for(var tab of window.tabs) {
        browser.tabs.sendMessage(tab.id, {
          "type": MessageTypes.ConfigChanged
        });
      }
    }
  } catch (e) {
    logger.error(e);
  }
}

function onInstalled(details) {
  if(details.temporary) {
    // On a temporary install (web-ext/debugging), auto-open the logs
    browser.windows.create({
      url: browser.runtime.getURL("logs.html")
    });
    logger.level = LogLevel.DEBUG;
  }
}

logger.info("Loading CookieMaster extension @ " + Date());
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

browser.cookies.onChanged.addListener(cookieChanged);
browser.webNavigation.onBeforeNavigate.addListener(beforeNavigate);
browser.tabs.onRemoved.addListener(tabRemoved);
browser.tabs.onUpdated.addListener(tabUpdated, { properties: ["status"]});
browser.runtime.onMessage.addListener(handleMessage);

browser.runtime.onInstalled.addListener(onInstalled);
