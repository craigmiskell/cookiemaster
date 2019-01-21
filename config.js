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

var ThirdPartyOptions = {
  AllowAll: 'AllowAll',
  AllowNone: 'AllowNone',
  AllowIfOtherwiseAllowed: 'AllowIfOtherwiseAllowed',
}

var CookieActions = {
  Blocked: 0,
  Allowed: 1,
  Unset: 2, //Neither blocked nor allowed
}

//Value type for DomainSettings.allowType
var AllowTypes = {
  Session: "Session", //Transient, no expires/max-age attributes
  Persistent: "Persistent", //Has (or is permitted to have) an expires/max-age
}

function DomainSettings(allowType) {
  this.allowType = allowType;
}

// Trying to do any localstorage async calls in an 'onInstalled'
// handler has a non-zero chance of failing because the async might be executing after
// the startup 'context' has gone away, and it just sort of falls over.
// So we can't upgrade the config and store that safely, because it might just not store.
// So, we wrap up our config in this class so we can be sure everything goes through one set
// of code that will handle upgrades seamlessly and safely (largely by shimming it until a
// user-driven save operation occurs which will have a context long enough to actually
// freaking save)
// Yes, this is a bit sucky; if you can show me a better way, I'm all ears.
class Config {
  constructor(config) {
    this.config = config
    if(!('thirdParty' in this.config)) {
      this.config.thirdParty = ThirdPartyOptions.AllowNone
    }
    if(!('ignoreSettingsWarning' in this.config)) {
      this.config.ignoreSettingsWarning = false;
    }
    if(!('allowList' in this.config)) {
      this.config.allowList = new Map();
    } else if(Array.isArray(this.config.allowList)) {
      //Convert to a map; will not save immediately, so will have to do this again
      //  whenever we create a new Config until a user-initiated save event occurs,
      // to safely write to local storage
      this.upgradeAllowListFromArrayToMap();
    }
  }
  get thirdParty() {
    return this.config.thirdParty;
  }
  set thirdParty(value) {
    this.config.thirdParty = value;
  }
  get ignoreSettingsWarning() {
    return this.config.ignoreSettingsWarning;
  }
  set ignoreSettingsWarning(value) {
    this.config.ignoreSettingsWarning = value;
  }
  get allowList() {
    return this.config.allowList;
  }

  setDomainAllow(domain, allowType) {
    this.config.allowList.set(domain, { allowType: allowType });
  }

  removeDomainFromAllowList(domain) {
    this.config.allowList.delete(domain);
  }

  //Private, use only from the constructor, when we were given an array instead
  upgradeAllowListFromArrayToMap() {
    console.log("Converting allowList to a map");
    //Convert to a map; key is the domian name, value is a DomainSettings object
    var newAllowList = new Map();
    for (var domain of this.config.allowList) {
      newAllowList.set(domain, new DomainSettings(AllowTypes.Persistent));
    }
    this.config.allowList = newAllowList;
  }

  //Returns the configured domain that allowed the named domain, or undefined if none do.
  domainIsAllowed(domain) {
    //Is a linear search ok?  Can't help but wonder if there's a more efficient technique.  Maybe a
    // transient cache of results would help?

    var candidates = [];
    //NB: Assumes the 'allow' list has leading dots on all entries, to properly terminate domain
    // components
    for (var [candidateDomain, candidateSettings] of this.config.allowList.entries()) {
      //Domain *must* start with a dot to match the allow list constraint
      if(!domain.startsWith('.')) {
        domain = '.'+domain;
      }
      if(domain.endsWith(candidateDomain)) {
        candidates.push({ domain: candidateDomain, settings: candidateSettings});
      }
    }
    //Find the longest domain name in the list of candidates; this is the most specific
    // domain in the list of domains the user has allowed, thus the one we should report
    // as being The One that permitted this cookie
    if(candidates.length > 0) {
      var result = candidates[0];
      for(var candidate of candidates) {
        if(candidate.domain.length > result.domain.length) {
          result = candidate;
        }
      }
      return result;
    }
    return undefined;
  }
  //Reduced set of domainIsAllowed, looking for an explicit match (where 'in' doesn't seem to work)
  domainInList(domain) {
    for(var cd of this.config.allowList.keys()) {
      if (domain == cd) {
        return true;
      }
    }
    return false;
  }

  async save() {
    await browser.storage.local.set(this.config);
  }

  static async resetToFactorySettings() {
    var config = new Config({});
    await config.save();
  }

  static async get() {
    var data = await browser.storage.local.get();
    return new Config(data);
  }
}


