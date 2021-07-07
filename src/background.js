/* global he */
'use strict';

const state = {  
  enabledTabs: new Set(),   // Manually enabled in these tabs.
  disabledTabs: new Set(),  // Manually disabled in these tabs.
  automaticTabs: new Set(), // Automatically enabled in these tabs.
  cacheHandle: null,        // Timeout for pruning and persisting cache.
};

const settings = {
  apiKey: '',
  target: 'en',
  domains: [],
  cacheSize: 1000,
  cacheData: [],  
  warnAfter: 400000,
  disableAfter: 480000,
  statistics: {
    month: new Date().getMonth(),
    characters: 0
  }
};

// Load initial settings and persisted cache data.
(async function () {  
  let data = await browser.storage.local.get(settings);
  settings.apiKey = data.apiKey;
  settings.target = data.target;
  settings.domains = data.domains;
  settings.cacheSize = data.cacheSize;
  settings.cacheData = data.cacheData;
  settings.warnAfter = data.warnAfter;
  settings.disableAfter = data.disableAfter;
  settings.statistics = data.statistics;

  // Reset the statistics on a month change.
  // Initialize the count in the browser action icon.
  incrementStatisticsCharacters(0);
  updateBrowserActionBadgeText();
})();

// Watch for changes to settings.
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    if (changes.apiKey) {
      settings.apiKey = changes.apiKey.newValue;
    }
    if (changes.target) {
      settings.target = changes.target.newValue;
    }
    if (changes.domains) {
      settings.domains = changes.domains.newValue;
    }
    if (changes.cacheSize) {
      settings.cacheSize = changes.cacheSize.newValue;
    }
    if (changes.warnAfter) {
      settings.warnAfter = changes.warnAfter.newValue;
      updateBrowserActionBadgeText();
    }
    if (changes.disableAfter) {
      settings.disableAfter = changes.disableAfter.newValue;
      updateBrowserActionBadgeText();
    }
    if (changes.statistics) {
      settings.statistics = changes.statistics.newValue;
      updateBrowserActionBadgeText();
    }
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Listeners

/**
 * Listen for messages from the content scripts.
 */
browser.runtime.onMessage.addListener((message) => {
  switch (message.topic) {
    case 'translate': {
      let target = message.target || settings.target;
      return translateChunks(target, message.q);
    }
  }
});

/**
 * Invoked when the browser action is clicked.
 * Enable or disable translation in a tab.
 */
browser.browserAction.onClicked.addListener((tab) => {
  // The API key must be configured.
  if (!settings.apiKey) {
    browser.runtime.openOptionsPage();
    return;
  }

  if (state.disabledTabs.has(tab.id)) {
    // Enable translation in a disabled tab.
    state.disabledTabs.delete(tab.id);
    enableTranslationInTab(tab.id);
  } else
  if (state.enabledTabs.has(tab.id)) {
    // Disable translation in an enabled tab.
    state.enabledTabs.delete(tab.id);
    disableTranslationInTab(tab.id);
  } else
  if (state.automaticTabs.has(tab.id)) {
    // Disable translation in an automatic tab.
    state.disabledTabs.add(tab.id);
    disableTranslationInTab(tab.id);
  } else {
    // Enable translation otherwise.
    state.enabledTabs.add(tab.id);
    enableTranslationInTab(tab.id);
  }
});

/**
 * Invoked when a tab is removed.
 * Forget the enabled/disabled state of removed tabs.
 */
browser.tabs.onRemoved.addListener((tabId) => {
  state.enabledTabs.delete(tabId);
  state.disabledTabs.delete(tabId);
  state.automaticTabs.delete(tabId);
});

/**
 * Invoked when a tab's URL is updated.
 * Enable transation for matching tabs and URLs.
 */
browser.tabs.onUpdated.addListener((tabId, changeInfo) => { 
  // The API key must be configured.
  if (!settings.apiKey) {
    return;
  }

  if (shouldTranslateTab(tabId, changeInfo)) {
    // Inject translation script on URL change.
    enableTranslationInTab(tabId);
  } else {
    // Reset the browser action icon.
    browser.browserAction.setIcon({
      tabId,
      path: null
    });
  }
}, {
  properties: [ 'url' ]
});

// ---------------------------------------------------------------------------------------------------------------------
// Addon business layer

/**
 * True if translation should be enabled for a tab, otherwise false.
 */
function shouldTranslateTab (tabId, changeInfo) {
  // Manually disabled tabs should not be translated.
  if (state.disabledTabs.has(tabId)) {
    return false;
  }

  // Manually enabled tabs should be translated.
  if (state.enabledTabs.has(tabId)) {
    return true;
  }

  // Matching domains should be translated.
  if (settings.domains.length) {
    let url = new URL(changeInfo.url);
    if (settings.domains.find(domain => ~url.host.indexOf(domain))) {
      state.automaticTabs.add(tabId);
      return true;
    } else {
      state.automaticTabs.delete(tabId);
      return false;
    }
  }

  return false;
}

/**
 * Increment the character count in the addon statistics.
 */
function incrementStatisticsCharacters (count) {
  // Reset the character count when the month changes.
  let thisMonth = new Date().getMonth();
  if (settings.statistics.month != thisMonth) {
    settings.statistics.month = thisMonth;
    settings.statistics.characters = 0;
  }

  // Increment the character count.
  settings.statistics.characters += count;

  // Persist the new statistics.
  browser.storage.local.set({ 
    statistics: settings.statistics 
  });
}

/**
 * Update the browser action badge text to reflect statistics.
 */
function updateBrowserActionBadgeText () {
  let characters = settings.statistics.characters;
  browser.browserAction.setTitle({
    title: `Translator (${characters.toLocaleString()} characters used)`
  });

  // Make the badge red if used too many characters.
  if ((settings.warnAfter > 0) && (characters > settings.warnAfter)) {
    browser.browserAction.setBadgeBackgroundColor({
      color: 'red'
    });
    browser.browserAction.setBadgeTextColor({
      color: 'white'
    });
  } else {
    browser.browserAction.setBadgeBackgroundColor({
      color: 'grey'
    });
    browser.browserAction.setBadgeTextColor({
      color: 'white'
    });
  }

  // Indicate how many characters have been used.
  if ((settings.disableAfter > 0) && (characters > settings.disableAfter)) {
    browser.browserAction.setBadgeText({
      text: 'OFF'
    });
  } else 
  if (characters >= 1000000) {
    browser.browserAction.setBadgeText({
      text: `${Math.floor(characters / 1000000)}m`
    });
  } else
  if (characters >= 1000) {
    browser.browserAction.setBadgeText({
      text: `${Math.floor(characters / 1000)}k`
    });
  } else {
    browser.browserAction.setBadgeText({
      text: `${characters}`
    });
  }
}

/**
 * Inject and enable the translation script in a tab.
 */
async function enableTranslationInTab (tabId) {
  // Inject the translation script into the tab.
  await browser.tabs.executeScript({
    file: '/translate.js'
  });

  // Update the browser action icon.
  browser.browserAction.setIcon({
    tabId,
    path: 'icons/translate-blue.svg'
  });
}

/**
 * Disable the translation script in a tab.
 */
async function disableTranslationInTab (tabId) {
  // Disable translation in the tab.
  browser.tabs.sendMessage(tabId, {
    topic: 'stopTranslate'
  });

  // Update the browser action icon.
  browser.browserAction.setIcon({
    tabId: tabId,
    path: null
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Translation engine

/**
 * Lookup an entry in the cache.
 */
function cacheGet (input, target) {
  for (let i = 0; i < settings.cacheData.length; i++) {
    let entry = settings.cacheData[i];
    if ((entry.input === input) && (entry.target === target)) {
      return entry.output;
    }
  }
  return null;
}

/**
 * Add an entry to the cache.
 */
function cacheSet (input, target, output) {
  settings.cacheData.unshift({
    input,
    output,
    target
  });
  
  // Schedule a prune and persist in the near future.
  // The timeout is used as an accumulator when there are multiple updates in a short time.
  if (state.cacheHandle) {
    clearTimeout(state.cacheHandle);
  }
  state.cacheHandle = setTimeout(() => {
    cachePrune();
    cachePersist();
  }, 5000);
}

/**
 * Clean old entries from the cache.
 */
function cachePrune () {
  while (settings.cacheData.length > settings.cacheSize) {
    settings.cacheData.pop();
  }
}

/**
 * Persist the cache to local storage.
 */
function cachePersist () {
  return browser.storage.local.set({
    cacheData: settings.cacheData
  });
}

/**
 * Divide an array into chunks.
 */
function chunkify (array, size = 100) {
  return array.reduce((chunks, textNode) => {
    let chunk = chunks[chunks.length - 1];
    if (chunk.length >= size) {
      chunk = [ textNode ];
      chunks.push(chunk);
    } else {
      chunk.push(textNode);
    }
    return chunks;
  }, [[]]);
}

/**
 * Divide a cloud translation API request into multiple requests to stay under per-request limits.
 */
async function translateChunks (target, q) {
  let results = [], chunks = chunkify(q, 100);
  for (var i = 0; i < chunks.length; i++) {
    results.push(...(await translate(target, chunks[i])));
  }
  return results;
}

/**
 * Invoke the cloud translation API.
 */
async function translate (target, q) {
  // Populate results from cached translation.
  let results = [], misses = [];
  for (let i = 0; i < q.length; i++) {
    let output = cacheGet(q[i], target);
    if (output) {
      // Input has cached translation.      
      results[i] = output;
    } else {
      // Input is not cached.
      misses.push({ i, q: q[i] });
    }      
  }
  
  // Attempt to translate cache misses.
  if (misses.length) {
    // Skip translation when the used characters has exceeded the threshold.
    // Instead fall through to the error handler that returns untranslated strings.
    let characters = settings.statistics.characters;
    if ((settings.disableAfter === 0) || (characters <= settings.disableAfter)) {
      let translations;
      try {
        // Translate the cache misses.  
        let res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${settings.apiKey}`, {
          method: 'POST',
          body: JSON.stringify({ 
            q: misses.map(miss => miss.q), 
            target 
          })
        });
        if (res.status === 200) {
          let json = await res.json();
          translations = json.data.translations;
        } else {
          throw new Error(`api returned status ${res.status}`);
        }
      }  catch (error) {
        // Something went wrong.
        console.log('translation failed', error);
        translations = null;
      }

      if (translations) {
        // Increment the character count for the addon.
        incrementStatisticsCharacters(misses.reduce((sum, miss) => sum + miss.q.length, 0));    

        // Insert the translations into the results.
        for (let i = 0; i < translations.length; i++) {
          // Populate results from translations.
          let output = he.decode(translations[i].translatedText);
          results[misses[i].i] = output;
          
          // Cache the translation result.
          cacheSet(misses[i].q, target, output);
        }

        return results;
      }
    } 
    
    // Error handler / translation is disabled.
    // Return cache misses untranslated.
    console.log('not translating');
    for (let i = 0; i < misses.length; i++) {
      results[misses[i].i] = misses[i].q;
    }
  }
  
  return results;
}

