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

function saveOptions() {
  var allowListSelect = document.querySelector("#allowList");
  var allowList = [];
  for (var option of allowListSelect.options) {
    allowList.push(option.value);
  } 
  var ignoreSettingsWarning = document.querySelector("#ignoreSettingsWarning").checked
  browser.storage.local.set({
    thirdParty: document.querySelector("#thirdParty").value,
    allowList: allowList,
    ignoreSettingsWarning: ignoreSettingsWarning
  });
  browser.runtime.sendMessage({"name": "configChanged"});
}

function addDomainToDisplayList(domain) {
  var allowListSelect = document.querySelector("#allowList");
  var newOption = document.createElement("option");
  newOption.value = domain;
  newOption.text = domain;

  for(var option of allowListSelect.options) {
    if(option.value > domain) {
      //This is the first option in the list which sorts lexically after the new one
      // so insert immediately before the it 
      allowListSelect.add(newOption, option);
      return;
    }
  }
  //Didn't find any existing option to insert before; chuck it on the end
  allowListSelect.add(newOption);
}

function displayOptions() {
  getConfig().then((config) => {
    document.querySelector("#thirdParty").value = config.thirdParty; 
    for (var domain of config.allowList) {
      addDomainToDisplayList(domain);
    }
    document.querySelector("#ignoreSettingsWarning").checked = config.ignoreSettingsWarning;
  });
}

function addSite(e) {
  var allowListSelect = document.querySelector("#allowList");
  var newSiteTextField = document.querySelector("#newSite");
  var domain = newSiteTextField.value; 

  for(var option of allowListSelect.options) {
    if(option.value == domain) {
      return;
    }
  }
  if(domain && (domain != "")) {
    addDomainToDisplayList(domain);
    newSiteTextField.value = "";
    saveOptions();
  }
}

function removeSites(e) {
  var allowListSelect = document.querySelector("#allowList");
  var selectedIndexes = [] 
  for (var option of allowListSelect.selectedOptions) {
    selectedIndexes.push(option.index);
  }
  //Reverse sort, so we're removing entries from the end first (not messing up the indexes of what remains)
  selectedIndexes.sort(function(a, b) {
    //Numerical comparison, not the default string; b-a => reverse sort
    return b - a;
  });
  for(var index of selectedIndexes) {
    allowListSelect.remove(index); 
  }
  saveOptions();
}

function contentLoaded() {
  displayOptions(); 
  //Can't do this until the content is loaded, with the script in <head>.  I like it there too
  document.querySelector("#thirdParty").addEventListener("change", saveOptions);
  document.querySelector("#ignoreSettingsWarning").addEventListener("change", saveOptions);
  document.querySelector("#resetSettingsForm").addEventListener("submit", resetSettings);

  document.querySelector("#removeSites").addEventListener("click", removeSites);
  document.querySelector("#addSite").addEventListener("click", addSite); 
  document.getElementById('helplink').href = browser.extension.getURL("help.html");
}

function resetSettings() {
  console.log("Clearing all settings");
  browser.storage.local.clear();
  resetToFactorySettings();
}
document.addEventListener('DOMContentLoaded', contentLoaded);
