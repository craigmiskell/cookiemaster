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
  browser.runtime.sendMessage({"type": MessageTypes.ConfigChanged});
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

var downloadIds = new Map();

function downloadsChanged(delta) {
  if(delta.state && (delta.state.current=="complete")) {
    if(downloadIds.has(delta.id)) {
      URL.revokeObjectURL(downloadIds.get(delta.id));
      downloadIds.delete(delta.id);
    }
  }
}

async function backupSettings(e) {
  var config = await getConfig();
  var json = [JSON.stringify(config)];
  var blob = new Blob(json, {type : 'application/json'});
  var url = URL.createObjectURL(blob);
  var downloadId = await browser.downloads.download({
    url: url,
    filename: "cookie-master-settings.json",
    saveAs: true
  });
  downloadIds.set(downloadId, url);
}

async function restoreSettings(e) {
  var fileSelector = document.querySelector("#restoreFile");
  var configText = await fileSelector.files[0].text();
  var config = JSON.parse(configText);

  // Not sure I like manipulating the UI and then saving, but it works.
  // Trouble is, I don't want tweo places constructing the config object, so
  // saveOptions is 'better'.
  // It might be better in the session cookies branch?
  document.querySelector("#thirdParty").value = config.thirdParty;
  document.querySelector("#ignoreSettingsWarning").checked = config.ignoreSettingsWarning;

  //Remove existing, add from uploaded config.  I *really* don't like this, but...
  var allowListSelect = document.querySelector("#allowList");
  for(var i = allowListSelect.length; i >= 0 ; i--) {
    allowListSelect.remove(i);
  }

  for(var domain of config.allowList) {
    addDomainToDisplayList(domain);
  }
  saveOptions();
  fileSelector.value = "";
}


// TODO: check the session-cookies branch logging commit to see why we changed to async here (is it necessary?)
function contentLoaded() {
  displayOptions();
  //Can't do this until the content is loaded, with the script in <head>.  I like it there too
  document.querySelector("#thirdParty").addEventListener("change", saveOptions);
  document.querySelector("#ignoreSettingsWarning").addEventListener("change", saveOptions);
  document.querySelector("#resetSettingsForm").addEventListener("submit", resetSettings);
  document.querySelector("#backupSettings").addEventListener("click", backupSettings);
  document.querySelector("#restoreSettings").addEventListener("click", restoreSettings);

  document.querySelector("#removeSites").addEventListener("click", removeSites);
  document.querySelector("#addSite").addEventListener("click", addSite);
  document.getElementById('openLogs').href = browser.runtime.getURL("logs.html");
  document.getElementById('helplink').href = browser.runtime.getURL("help.html");
}

function resetSettings() {
  logger.warn("Clearing all settings");
  browser.storage.local.clear();
  resetToFactorySettings();
}

function handleMessage(message, sender, sendMessage) {
  switch(message.type) {
    case MessageTypes.MessageLogged:
      displayLogs();
      break;
  }
}

document.addEventListener('DOMContentLoaded', contentLoaded);

browser.downloads.onChanged.addListener(downloadsChanged);
browser.runtime.onMessage.addListener(handleMessage);
