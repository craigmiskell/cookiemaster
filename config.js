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

async function getConfig() {
  try {
    var config = await browser.storage.local.get();
  } catch(e) {
    console.error("caught exception");
    console.error(e);
  }
  if(!('ready' in config)) {
    resetToFactorySettings();
    return browser.storage.local.get();
  }
  return config;
}
async function resetToFactorySettings() {
  var config= {};
  config.thirdParty = ThirdPartyOptions.AllowNone
  config.allowList = [];

  config.ready = true;
  await browser.storage.local.set(config);
}

//Returns the configured domain that allowed the named domain, or undefined if none do.
function domainIsAllowed(config, domain) {
  //Is a linear search ok?  Can't help but wonder if there's a more efficient technique.  Maybe a
  // transient cache of results would help?

  var candidates = [];
  //NB: Assumes the 'allow' list has leading dots on all entries, to properly terminate domain
  // components
  for (var candidate of config.allowList) {
    //Domain *must* start with a dot to match the allow list constraint
    if(!domain.startsWith('.')) {
      domain = '.'+domain;
    }
    if(domain.endsWith(candidate)) {
      candidates.push(candidate);
    }
  }
  if(candidates.length > 0) {
    var result = candidates[0];
    for(var candidate of candidates) {
      if(candidate.length > result.length) {
        result = candidate;
      }
    }
    return result;

  }
  return undefined;
}

//Reduced set of domainIsAllowed, looking for an explicit match (where 'in' doesn't seem to work)
function domainInList(config, domain) {
  for(var cd of config.allowList) {
    if (domain == cd) {
      return true;
    }
  }
  return false;
}

module.exports = {
  domainIsAllowed: domainIsAllowed
}