This project is a remnant of a past time, when cookies were the predominant way to track somone's usage across the web, 3rd-party cookies were rampant, and at least the hint of privacy was generally achievable.

We are no longer in that time; there are far more signals in use today than a simple cookie.  Check out https://sudotool.com/tools/browser-privacy-checker, https://coveryourtracks.eff.org/ or any of the myriads of similar tools.  The actual report results don't matter, just look at the number of techniques in use, and which ones matter the most, and you'll discover that cookies simply aren't a significant contributor anymore.

Is privacy dead?  Maybe, maybe not (but probably more the former).  But you can still make it harder for prying eyes, and the tools to do so are built-in to Firefox these days.  I strongly commend:

1. Enhanced Tracking Protection: 
  * Customized, in particular "Isolate cross-site cookies"; they still exist, and let things like SSO logins and other *useful* things work, but each website has its own primary container.  So if I visit a.com and there's an embedded resource fro facebook.com that sets a 3rd party cookie, facebook only get that cookie again for visits to a.com.  If you also visit b.com also with a facebook embedded resource, Firefox does not sent the a.com-related facebook cookie.  Honestly, I turn all the other settings on as well, and I've yet to find anything that's particularly broken.  
2. privacy.resistFingerprinting (use about:config to set it).  With a side-order of privacy.resistFingerprinting.exemptedDomains as a (comma separated?) list of domains that you trust a bit more (like my bank, for example).  The biggest thing this throws up is it sets your timezone to 00:00 UTC, and lots of sites use that to render information.  In my case, it's a bit dumb because my locale of en\_NZ pretty much gives the game away, and I'm not willing to switch to en\_US.

These are both more robust than anything an extension can ever do, and I expect the Firefox team to continue enhancing them.  

This extension still works, will work for the forseeable future (as long as Firefox supports Manifest v2, which I expect it will), but I'm not planning on maintaining it any further.  I don't even use it myself anymore (favouring the above).

Good luck out there, it's a trashfire
