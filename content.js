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

/*
A content script injected into *every* page, that hooks document.cookie
so that we can detect a cookie being set by javascript more accurately
than just receiving the cookies.onChanged notification (with no tab/frame info)

It's a bit funky, in that we have to use add a script tag to the page to run the
hook code in the context of the *page* (the content-script context is sandboxed
from that) so as to be able to hook the cookies property in the first place.
See also CSP handling in background.js (processHeader) where we add a hash
to the relevant script-src (if any) to *allow* this inline script to execute.
Historical note: we started with window.eval to install thhe hook, so as to
install it really early on (vs adding a script tag), but:
 1. It ran foul of any sensible CSP, and would require adding 'unsafe-eval'
    which would be a terrible thing to do to the security of every page that had
    tried to set a sensible CSP header.
 2. We need the `config` which can only be loaded async, so we still had to
    install the hook in an await function, so we still missed some early cookies
    meaning the eval wasn't significantly better than adding a script tag.

Now you might think we should call into the background page to do the validation
but such a call is async, and thus setting the cookie only happens a bit later
when that call returns.  So any code that sets and then *immediately* checks for
that cookie will fail (this happens for real, e.g. hushmail.com).  So we have to
use window.dispatchEvent (synchronous), do the validation on the content-script
context, and only the notify the background script of what the decision was
for recording.  It's a smidgen more complicated than desirable, but seems to
work.  Yay for async.... :(

Additionally: we keep the bulk of the code in this file, not in the injected
script because there is a lot of included code (e.g. cookie_parse) that we'd
have to duplicate into the embedded script tag, which adds complexity.
We have to pass an even out eventually, so we just pass in processed information
to the script (via additional data tags in the `head` of the document)
so that it can make quick decisions.
*/
var logger = contextSafeLogger();

// TODO: Instead of loading the config at first run (see startup()),
// see if we can use the contentScripts.register API from background.js
// to register (and de-register as necessary) the content scripts for the page
// with a 'code' type script that assigns the current config (that background
// already has available without an async call) to the 'config' var.
// For best results we'll probably have to:
// 1) Fully define the entire contentscript in that registration, rather than
//    in manifest.json, so we can get the ordering right (config needs to be 1st)
// 2) Perhaps still do an async getConfig() in startup() if config is null, just
//    in case.  But we want startup() to be sync if possible, so rearrange such
//    that *if* config is null, do an async load and then call a new function
//    which does the eval/injection, but if config is defined, just immediately
//    (sync) call the eval/injection function.  Gives a good result where we
//    everything works, and a tolerable one when it doesn't.
var config;

window.addEventListener("scriptedCookieSet", async function(e) {
  var response = allowScriptedCookieSet(cookieparse(e.detail), window.location)

  // Setting 'document.cookie' in this function relies deeply on
  // https://developer.mozilla.org/en-US/docs/Mozilla/Tech/Xray_vision
  // where this event handler is in the *content-script* context and thus
  // gets a 'clean' view of the document, and thus doesn't see the overridden
  // cookie property setter that we create in the *window* context (via script
  // injection).
  // Side note: this x-ray vision thing is both good (security), and annoying
  // (requires shenanigans), *except* in this case when it's really helpful
  // because otherwise we'd have to send events back to the window context,
  // which is painful, and has security-risk implications (passing objects,
  // trusting the messages, etc)
  if(response == undefined) {
    // undefined means 'deleting'. We must still assign to document.cookie
    // so that the normal handler will actually delete the cookie.
    // But, we don't want to carry on to sending messages, because
    // we havn't actually allowed or denied a cookie (in the sense that
    // requires alerting the user)
    document.cookie = e.detail;
    return;
  } else if(response.allowed) {
    logger.info("Javascript cookie allowed on "+window.location);

    document.cookie = e.detail;
  } else {
    // Response exists, but not 'allowed' (i.e. denied)
    logger.info("Javascript cookie denied on "+window.location);
  }
  // Note that some of the information we need (tabId + frameId) is generated by
  // browser.runtime (we can"t easily get it in this context), and is critical
  await browser.runtime.sendMessage({
     "type": MessageTypes.ScriptedCookieEvent,
     "domain": response.domain,
     "configDomain": response.configDomain,
     "allowed": response.allowed
  });
});

async function handleMessage(message, sender, sendResponse) {
  switch (message.type) {
    case MessageTypes.ConfigChanged:
      config = await getConfig();
      var c = document.getElementById('cookiemaster-cookieenabled-data');
      var configDomain = domainIsAllowed(config, new URL(window.location).hostname);
      c.innerText = (configDomain != undefined);
      break;
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
    logger.debug("Cookie is being deleted because "+expires+" is before "+date);
    return true
  } else if (cookie.hasOwnProperty('max-age') && (cookie['max-age'] <= 0)) {
    return true;
  }
  return false;
}

// This function has a terrible interface; instead of 'undefined' => deleted,
// it should always return an object but with another flag for the delete
// case.  Probably cobbled this together from other code when moving it into the
// content script.  I should fix this.
function allowScriptedCookieSet(cookie, url) {
  try {
    if (cookieIsBeingDeleted(cookie)) {
      return undefined;
    }
    var domain = new URL(url).hostname;
    var configDomain = domainIsAllowed(config, domain);
    //Record this activity against the configuration domain which allowed the
    // cookie, otherwise use the domain of the cookie itself when blocking.
    var recordDomain = configDomain || domain;
    return {
      "allowed": (configDomain != undefined),
      "domain": domain,
      "configDomain": configDomain
      }
  } catch(e) {
    console.log(e);
    logger.error(e)
  }
}
async function startup() {
  // Cannot capture cookies until we have config, and that is async
  // So we have to do this in an async function, and only inject
  // our capturing code *after* we have config.
  // Downside: we may miss early cookies, so we're going to have to still
  // try and capture those with events. Boooooo. Hisssss. Booooo
  config = await getConfig();
  try {
    var s = document.createElement('script');
    s.text = windowContextContentScript;
    (document.head || document.documentElement).appendChild(s);

    // Pass in some data for overriding navigator.cookieEnabled
    var c = document.createElement('cookiemaster-config-data');
    c.id = 'cookiemaster-cookieenabled-data';
    var configDomain = domainIsAllowed(config, new URL(window.location).hostname);
    c.innerText = (configDomain != undefined);
    // Shove it in 'head' so it cannot possibly render in the body.
    // We can find it (by id) regardless.
    document.head.appendChild(c);
  } catch(e) {
      console.log(e);
      logger.error(e)
  }


}
browser.runtime.onMessage.addListener(handleMessage);

startup();
