// Define this in a var so that we can get a reliable SHA hash for mucking with CSP
// Rather than just calculating it once and then forgetting to update it when this
// script (which is eval'd) is updated.

// Many thanks to @gregers on https://stackoverflow.com/questions/32410331/proxying-of-document-cookie
// for inspiration.
var windowContextContentScript = `
  var cookiePropertyDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
  Object.defineProperty(Document.prototype, "cookie", {
    get: cookiePropertyDescriptor.get,
    set: function(value) {
      var event = new CustomEvent("scriptedCookieSet",
        {
          detail: value
        }
      );
      // It is absolutely critical that this call to dispatchEvent is, as the
      // documentation claims, synchronous (not async).  It *must* execute
      // the event handling code, in the content-script context, and set the
      // cookie (if allowed) before this 'set' implementation finishes and
      // returns, otherwise it does not accurately emulate the interface.  Code
      // that then goes to immediately retrieve the cookie (e.g. testing
      // if cookies are settable) will fail if this requirement is not met.
      window.dispatchEvent(event);
    }
  });

  Object.defineProperty(Navigator.prototype, "cookieEnabled", {
    get: function() {
      var dataElement =  document.getElementById('cookiemaster-cookieenabled-data');
      return dataElement.innerText == "true";
    }
  });
`;
var windowContextContentScriptSHA256 = undefined;

async function getWindowContextContentScriptSHA256() {
  if(windowContextContentScriptSHA256 == undefined) {
    const msgUint8 = new TextEncoder().encode(windowContextContentScript);  // encode as (utf-8) Uint8Array
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    var hash = await crypto.subtle.digest('SHA-256', hashBuffer);
    // convert buffer to byte array
    var hashArray = Array.from(new Uint8Array(hashBuffer));
    // and convert it to a base64 encoded string
    windowContextContentScriptSHA256 = btoa(String.fromCharCode(...new Uint8Array(hashArray)));
  }
  return windowContextContentScriptSHA256;
}
