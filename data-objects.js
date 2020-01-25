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

class TabInfo {
  constructor() {
    this._url = undefined;
    this._allowedFirstPartyDomains = new Map();
    this._allowedThirdPartyDomains = new Map();
    this._blockedFirstPartyDomains = new Map();
    this._blockedThirdPartyDomains = new Map();
    this._created = Date.now(); //When this tabInfo was created; used for filtering 'other' cookies set by code
    this._updated = Date.now(); //When this tabInfo last had some cookie or domain info updated.
    this._browserActionIcon = undefined;
  }

  static fromObject(obj) {
    var result = new TabInfo();
    result._url = obj._url;
    result._allowedFirstPartyDomains = obj._allowedFirstPartyDomains;
    result._allowedThirdPartyDomains = obj._allowedThirdPartyDomains;
    result._blockedFirstPartyDomains = obj._blockedFirstPartyDomains;
    result._blockedThirdPartyDomains = obj._blockedThirdPartyDomains;
    result._created = obj._created;
    result._updated = obj._updated;
    result._browserActionIcon = obj._browserActionIcon;
    //Don't worry about the 'has*' properties; we don't use them in the popup
    return result;
  }

  get allowedFirstPartyDomains() {
    return this._allowedFirstPartyDomains;
  }
  get allowedThirdPartyDomains() {
    return this._allowedThirdPartyDomains;
  }
  get blockedFirstPartyDomains() {
    return this._blockedFirstPartyDomains;
  }
  get blockedThirdPartyDomains() {
    return this._blockedThirdPartyDomains;
  }
  get created() {
    return this._created;
  }
  get updated() {
    return this._updated
  }
  get browserActionIcon() {
    return this._browserActionIcon;
  }
  set browserActionIcon(value) {
    this._browserActionIcon = value;
  }

  // Registers that a cookie with domain `cookieDomain` was set or blocked
  // because of configuration for `configDomain`.  For blocked we
  // expect cookieDomain == configDomain (although don't enforce or require this)
  // Stores it against the frameId, so 2 levels of nested maps.
  // Why not create a proper class + data structure?  Because we need to pass
  // this data from background to popup, thus serialise it, and doing so is a
  // royal PITA (see "fromObject" above for just this class).  Maps and Sets
  // 'Just Work'
  // Data structure is a top level Map, keys being frame id.
  // For each frameid, it is a map; the keys are the configDomains (the domains
  // that were in the configuration that allowed/blocked the cookie) and the
  // values are *Set* objects; the set values are the actual domains of the
  // cookies that were allowed/blocked.
    _registerCookie(store, cookieDomain, configDomain, frameId) {
    var frameData = store.get(frameId)
    if(!frameData) {
      frameData = new Map();
      store.set(frameId, frameData);
    }

    var cd = frameData.get(configDomain);
    if(!cd) {
      cd = new Set();
      frameData.set(configDomain, cd);
    }
    cd.add(cookieDomain);
  }

  registerAllowedFirstPartyCookie(cookieDomain, configDomain, frameId) {
    this._registerCookie(this._allowedFirstPartyDomains, cookieDomain, configDomain, frameId);
  }
  registerAllowedThirdPartyCookie(cookieDomain, configDomain, frameId) {
    this._registerCookie(this._allowedThirdPartyDomains, cookieDomain, configDomain, frameId);
  }

  // When blocked, the domain which caused the blocking is the cookie domain
  // (there was no domain listed in configuration that caused it to be blocked)
  registerBlockedFirstPartyCookie(cookieDomain, frameId) {
    this._registerCookie(this._blockedFirstPartyDomains, cookieDomain, cookieDomain, frameId);
  }
  registerBlockedThirdPartyCookie(cookieDomain, frameId) {
    this._registerCookie(this._blockedThirdPartyDomains, cookieDomain, cookieDomain, frameId);
  }

  markUpdated() {
    this._updated = Date.now();
  }
}
