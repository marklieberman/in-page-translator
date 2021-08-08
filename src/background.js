/* global he */
'use strict';

const state = {  
  enabledTabs: new Set(),   // Manually enabled in these tabs.
  disabledTabs: new Set(),  // Manually disabled in these tabs.
  automaticTabs: new Set(), // Automatically enabled in these tabs.
  caches: {}                // List of cache managers.
};

const settings = {
  target: 'en',
  cacheSize: 1000,
  overrides: [],
  providers: [],
  quotas: {}
};

// Load initial settings and persisted cache data.
(async function () {  
  let data = await browser.storage.local.get(settings);
  settings.target = data.target;
  settings.overrides = data.overrides;
  settings.cacheSize = data.cacheSize;
  settings.providers = data.providers;
  settings.quotas = data.quotas;

  // Check and reset quotas on startup.
  checkResetQuotas();
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
    if (changes.overrides) {
      settings.overrides = changes.overrides.newValue;
    }
    if (changes.cacheSize) {
      settings.cacheSize = changes.cacheSize.newValue;
    }
    if (changes.providers) {
      settings.providers = changes.providers.newValue;
    }
    if (changes.quotas) {
      settings.quotas = changes.quotas.newValue;
    }
  }
});

// Add the context menu item.
browser.menus.create({
  id: 'translate-selection',
  title: 'Translate Selection',
  contexts: [ 'selection' ]
});

// ---------------------------------------------------------------------------------------------------------------------
// Listeners

/**
 * Listen for messages from the content scripts.
 */
browser.runtime.onMessage.addListener(async (message) => {
  switch (message.topic) {
    case 'translate': {      
      // Check and reset quotas before translating.
      await checkResetQuotas();

      // Perform the translation.
      let target = message.target || settings.target;      
      let result = await translate(target, message.q, message.override, message.manual);

      // Update the browser action icon.
      await updateBrowserActionBadge(result.provider, result.error);

      // Return the results without the provider.
      state.recentProvider = result.provider;
      delete result.provider;
      return result;
    }
    case 'findOverride': {
      // Find any override for a host.
      return findOverride(message.host);
    }
    case 'flushCache': {
      // Delete the contents of the cache.
      settings.cacheData = [];
      return browser.storage.local.set({ 
        cacheData: [] 
      });
    }
    case 'quotaEdited': {
      // Redraw the badge.
      let provider = settings.providers.find(provider => provider.quotaKey === message.quotaKey);
      updateBrowserActionBadge(provider);
    }
  }
});

/**
 * Invoked when the browser action is clicked.
 * Enable or disable translation in a tab.
 */
browser.browserAction.onClicked.addListener((tab) => {
  // The API key must be configured.
  if (!settings.providers.length) {
    browser.runtime.openOptionsPage();
    return;
  }

  // Ignore clicks from non http tabs.
  if (!tab.url.startsWith('http')) {
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
 * Invoked when a tab is created.
 * Enable transation for matching tabs and URLs.
 */
browser.tabs.onCreated.addListener((tab) => { 
  // The API key must be configured.
  if (!settings.providers.length) {
    return;
  }

  if (shouldTranslateTab(tab.id, { url: tab.url })) {
    // Inject translation script on URL change.
    enableTranslationInTab(tab.id);
  } else {
    // Reset the browser action icon.
    browser.browserAction.setIcon({
      tabId: tab.id,
      path: null
    });
  }
});

/**
 * Invoked when a tab's URL is updated.
 * Enable transation for matching tabs and URLs.
 */
browser.tabs.onUpdated.addListener((tabId, changeInfo) => { 
  // The API key must be configured.
  if (!settings.providers.length) {
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

/**
 * Invoked when the context menu item is clicked.
 */
browser.menus.onClicked.addListener((clickInfo, tab) => {
  if (tab) {
    switch (clickInfo.menuItemId) {
      case 'translate-selection': {
        // Inject the translation script into the tab.    
        browser.tabs.executeScript(tab.id, {
          file: '/content/selection-translate.js',
          runAt: 'document_end',
          frameId: clickInfo.frameId
        });
        break;
      }
    }
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Addon business layer

/**
 * Find any configured override for a domain. 
 */
function findOverride (host) {
  return settings.overrides.find(override => {
    if (override.matchRegex) {
      // Match based on regular expression pattern.
      return new RegExp(override.matchDomain, 'i').test(host);
    } else {
      // Match on any one of comma separated domains.
      return override.matchDomain
        .split(',')
        .map(v => v.trim())
        .find(v => host.includes(v));
    }
  });
}

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
  let url = new URL(changeInfo.url);
  if (findOverride(url.host)) {
    state.automaticTabs.add(tabId);
    return true;
  } else {
    state.automaticTabs.delete(tabId);
    return false;
  }
}

/**
 * Inject and enable the translation script in a tab.
 */
async function enableTranslationInTab (tabId) {
  // Inject the translation script into the tab.
  browser.tabs.executeScript(tabId, {
    file: '/content/page-translate.js',
    runAt: 'document_end'
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

/**
 * Update the appearance of the browser action text..
 */
async function updateBrowserActionBadge (recentProvider, lastError) {
  if (recentProvider === 'cache') {
    // Last translation was served by cache.
    return;
  }

  if (lastError) {
    switch (lastError) {
      case ERROR_NO_PROVIDERS:
      case ERROR_ALL_PROVIDERS_QUOTA_EXCEEDED:
        // No providers are available.
        browser.browserAction.setBadgeText({
          text: 'OFF'
        });
        browser.browserAction.setBadgeBackgroundColor({
          color: 'gray'
        });
        browser.browserAction.setBadgeTextColor({
          color: 'black'
        });
        return;      
      default:
        // Unknown error.
        browser.browserAction.setBadgeText({
          text: 'ERR'
        });
        browser.browserAction.setBadgeBackgroundColor({
          color: 'gray'
        });
        browser.browserAction.setBadgeTextColor({
          color: 'red'
        });
        return;
    }
  }

  if (recentProvider) {
    // Get the quota by passing nothing for consumption parameter.
    let quota = await incrementQuota(recentProvider);

    if ((recentProvider.warnAfter === 0) || (quota.characters <= recentProvider.warnAfter)) {
      // Color mode is normal.
      browser.browserAction.setBadgeTextColor({
        color: recentProvider.color || 'black'
      });
      browser.browserAction.setBadgeBackgroundColor({
        color: recentProvider.bgColor || 'white'
      });
    } else {
      // Color mode is warning.
      browser.browserAction.setBadgeTextColor({
        color: recentProvider.bgColor || 'black'
      });
      browser.browserAction.setBadgeBackgroundColor({
        color: recentProvider.color || 'white'
      });
    }

    // Display the quota for the recent provider.
    if (recentProvider.stopAfter > 0) {
      if (quota.characters >= 1000000000) {      
        browser.browserAction.setBadgeText({
          text: '∞'
        });      
      } else
      if (quota.characters >= 10000000) {
        // Format: '999'
        browser.browserAction.setBadgeText({
          text: `${Math.floor(quota.characters / 1000000)}`
        });      
      } else
      if (quota.characters >= 100000) {
        // Format: '9.9'
        browser.browserAction.setBadgeText({
          text: `${Math.floor(quota.characters / 100000) / 10}`
        });
      } else
      if (quota.characters >= 1) {
        browser.browserAction.setBadgeText({
          text: '~0'
        });
      } else {
        browser.browserAction.setBadgeText({
          text: '0'
        });
      }
    } else {
      browser.browserAction.setBadgeText({
        text: null
      });
    }
  } 
}

// ---------------------------------------------------------------------------------------------------------------------
// Translation engine

const ERROR_NO_PROVIDERS = 'no_providers';
const ERROR_CHARACTER_QUOTA_EXCEEDED = 'character_quota_exceeded';
const ERROR_ALL_PROVIDERS_QUOTA_EXCEEDED = 'all_providers_quota_exceeded';

class CacheManager {

  constructor (cacheName, cacheSize) {
    this.cacheName = cacheName;
    this.cacheSize = cacheSize;
    this.cacheData = null;
    this.cacheHandle = null;
    this.released = false;
  }

  setCacheSize (cacheSize) {
    this.cacheSize = cacheSize;
  }

  /**
   * Load the cache data from storage.
   */
  async load () {    
    this.released = false;
    if (!this.cacheData) {
      console.log('loading cache', this.cacheName);
      const data = {};
      data[this.cacheName] = [];
      this.cacheData = (await browser.storage.local.get(data))[this.cacheName];    
    }
  }

  /**
   * Release the cache.
   * Cache can be removed from memory once released.
   */
  release () {    
    if (this.cacheHandle) {
      // Wait for persist to finish.
      this.released = true;
    } else {
      // Immediately clear memory.
      console.log('release cache (immediate)', this.cacheName);
      this.cacheData = null;
      this.released = false;
    }
  }

  /**
   * Lookup an entry in the cache.
   */
  get (input, target) {
    for (let i = 0; i < this.cacheData.length; i++) {
      let entry = this.cacheData[i];
      if ((entry.input === input) && (entry.target === target)) {
        // Treating cache like LRU so move hit to top of the list.
        this.cacheData.splice(i, 1);
        this.cacheData.unshift(entry);

        // Schedule a prune and persist pass in the near future.
        this.schedulePersistPass();

        return entry.output;
      }
    }
    return null;
  }

  /**
   * Add an entry to the cache.
   */
  set (input, target, output) {
    this.cacheData.unshift({
      input,
      output,
      target
    });
    
    // Schedule a prune and persist pass in the near future.
    this.schedulePersistPass();
  }

  /**
   * Schedule a cache prune and persist pass in the neat future.
   * Multiple calls will cancel any existing scheduled pass.
   */
  schedulePersistPass () {
    // Schedule a prune and persist in the near future.
    // The timeout is used as an accumulator when there are multiple updates in a short time.
    if (this.cacheHandle) {
      clearTimeout(this.cacheHandle);
      this.cacheHandle = null;
    }
    let self = this;
    this.cacheHandle = setTimeout(() => {
      self.cacheHandle = null;
      self.prune();
      self.persist();
    }, 5000);
  }

  /**
   * Clean old entries from the cache.
   */
  prune () {
    console.log('pruning cache', this.cacheName, this.cacheData.length);
    this.cacheData.length = Math.min(this.cacheData.length, this.cacheSize);
  }

  /**
   * Persist the cache to local storage.
   * Unload the cache data from memory.
   */
  async persist () {
    console.log('persisting cache', this.cacheName);
    const data = {};
    data[this.cacheName] = this.cacheData;
    await browser.storage.local.set(data);
    if (this.released) {
      console.log('release cache (delayed)', this.cacheName);
      this.cacheData = null;
      this.released = false;
    }
  }

}

/**
 * Get a cache manager instance.
 */
function getCacheForOverride (override) {
  const cacheName = override.dedicatedCache ? override.dedicatedCacheName : 'cache-default';
  const cacheSize = override.dedicatedCache ? override.dedicatedCacheSize : settings.cacheSize;
  let cache = state.caches[cacheName];
  if (cache) {
    // Update the cache size in case it changed.
    cache.setCacheSize(cacheSize);
  } else {
    // Create a new cache manager instance.
    cache = state.caches[cacheName] = new CacheManager(cacheName, cacheSize);
  }
  return cache;
}

/**
 * Reset any quotas that are past the reset date.
 */
async function checkResetQuotas () {
  let now = new Date(), 
      month = now.getMonth(), 
      day = now.getDate(), 
      anyReset = false;

  for (let i = 0; i < settings.providers.length; i++) {
    let provider = settings.providers[i];
    let quota = settings.quotas[provider.quotaKey];
    if (quota) {
      if ((month !== quota.month) && (day >= provider.resetOn)) {
        console.log('reset quota for', provider.quotaKey);
        quota.month = month;
        quota.characters = 0;
        anyReset = true;
      }
    }
  }
  if (anyReset) {
    await browser.storage.local.set({
      quotas: settings.quotas
    });
  }
}

/**
 * Add to the quota consumed by a provider.
 */
async function incrementQuota (provider, consumed = {}) {  
  let quota = settings.quotas[provider.quotaKey], 
      anyChanges = false;

  if (!quota) {
    settings.quotas[provider.quotaKey] = (quota = {
      month: new Date().getMonth(),
      characters: 0
    });
  }
  if (Number.isFinite(consumed.characters) && (consumed.characters !== 0)) {
    quota.characters += consumed.characters;
    anyChanges = true;
  }
  if (anyChanges) {
    await browser.storage.local.set({
      quotas: settings.quotas
    });
  }
  return quota;
}

/**
 * Throw an exception if any cunsumed property exceed a quota.
 */
function throwIfExceedsQuota (provider, consumed) {
  let quota = settings.quotas[provider.quotaKey];
  if (quota) {
    // Check character quota if enabled.
    if (consumed.characters && (provider.stopAfter > 0)) {
      if ((quota.characters + consumed.characters) > provider.stopAfter) {
        throw ERROR_CHARACTER_QUOTA_EXCEEDED;
      }
    }
  }
}

/**
 * Translate an array of strings. 
 */
async function translate (target, q, override = {}, manual = false) {  
  let outputs = [], 
      misses = [], 
      error = null, 
      provider = null;

  // Populate the outputs array from cached translations.
  const cache = getCacheForOverride(override);
  await cache.load();
  
  for (let i = 0; i < q.length; i++) {
    let output = cache.get(q[i], target);
    if (output) {
      // Input has a cached translation.      
      outputs[i] = output;
    } else {
      // Input is not cached.
      misses.push({ i, q: q[i] });
    }      
  }

  // Copy all inputs to missed outputs without translation.
  function passThruMissed () {
    for (let i = 0; i < misses.length; i++) {
      outputs[misses[i].i] = misses[i].q;
    }  
  }

  if (misses.length) {    
    // Invoke the providers if there are cache misses and:
    // 1) the manual flag is set, or
    // 2) the cacheOnly flag is not set.
    if (!manual && override.cacheOnly) {
      passThruMissed();
    } else {
      try {        
        let providers = settings.providers.filter(provider => provider.enabled);
        if (!providers.length) {
          // No providers are defined or enabled.
          throw ERROR_NO_PROVIDERS;
        }

        // Test each provider until one is able to provide a translation.
        let translations = null;
        for (let i = 0; (i < providers.length) && (translations === null); i++) {        
          try {
            // Submit the input to the provider.
            provider = providers[i];
            switch (provider.service) {
              case 'azure':
                translations = await azureTranslate(provider, target, misses, cache);
                break;
              case 'google':
                translations = await googleTranslate(provider, target, misses, cache);
                break;
              default:
                // Should never happen.
                throw new Error('unsupported provider');
            }

            if (!translations.length) {
              // Should never happen.
              throw new Error('output was empty');
            }

            // Copy translations into the outputs array.
            for (let i = 0; i < misses.length; i++) {
              outputs[misses[i].i] = translations[i];
            }
          } catch (error) {
            if (error === ERROR_CHARACTER_QUOTA_EXCEEDED) {
              // Current provider does not have enough characters to process this request.
              // Try the next provider, if available.
              console.log('quota exceeded for', provider.quotaKey);
              continue;
            } else {
              throw error;
            }
          }
        }
        if (translations === null) {
          // All providers over quota.
          provider = null;
          throw ERROR_ALL_PROVIDERS_QUOTA_EXCEEDED;
        }
      } catch (ex) {
        // Translation failed; return untranslated strings.
        error = (ex instanceof Error) ? ex.message : ex;
        console.log('translation failed', error);
        passThruMissed();
      }
    }
  }

  // Done using this cache.
  cache.release();

  return {
    provider,
    outputs,
    error
  };
}

/**
 * Divide an array of misses into chunks with a maximum number of elements and total characters.
 */
function chunkifyMisses (misses, maxElements, maxCharacters) {
  let chunks = [[]];
  chunks.$characters = 0;  
  chunks[0].$characters = 0;
  return misses.reduce((chunks, miss) => {    
    chunks.$characters += miss.q.length;
    let chunk = chunks[chunks.length - 1];        
    if ((chunk.length >= maxElements) || (chunk.$characters + miss.q.length) >= maxCharacters) {
      chunk = [ miss ];
      chunk.$characters = miss.q.length;
      chunks.push(chunk);
    } else {
      chunk.push(miss);
      chunk.$characters += miss.q.length;
    }
    return chunks;
  }, chunks);
}

/**
 * Use Microsoft Azure as the translation provider. 
 */
async function azureTranslate(provider, target, misses, cache) {
  let results = [], 
      chunks = chunkifyMisses(misses, 100, 10000);

  // Check if the quota can handle this request.
  throwIfExceedsQuota(provider, {
    characters: chunks.$characters
  });

  for (var i = 0; i < chunks.length; i++) {
    let chunk = chunks[i];
    let res = await fetch(`https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=${target}`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': provider.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(chunk.map(miss => ({ Text: miss.q })))
    });

    if (res.status === 200) {
      let json = await res.json();

      // Increment the characters quota for this provider.
      await incrementQuota(provider, {
        characters: chunk.$characters
      });

      // Translations array should be 1:1 with the chunk.
      for (let j = 0; j < chunk.length; j++) {
        let output = he.decode(json[j].translations[0].text);
        results.push(output);
        cache.set(chunk[j].q, target, output);
      }
    } else {
      throw new Error(`api returned status ${res.status}`);
    }
  }

  return results;
}

/**
 * Use Google Cloud Platform as the translation provider. 
 */
async function googleTranslate(provider, target, misses, cache) {
  let results = [], 
      chunks = chunkifyMisses(misses, 100, 5000);

  // Check if the quota can handle this request.
  throwIfExceedsQuota(provider, {
    characters: chunks.$characters
  });

  for (var i = 0; i < chunks.length; i++) {
    let chunk = chunks[i];
    let res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${provider.apiKey}`, {
      method: 'POST',
      body: JSON.stringify({ 
        q: chunk.map(miss => miss.q), 
        target 
      })
    });

    if (res.status === 200) {
      let json = await res.json();

      // Increment the characters quota for this provider.
      await incrementQuota(provider, {
        characters: chunk.$characters
      });

      // Translations array should be 1:1 with the chunk.
      let translations = json.data.translations;
      for (let j = 0; j < chunk.length; j++) {
        let output = he.decode(translations[j].translatedText);
        results.push(output);
        cache.set(chunk[j].q, target, output);
      }
    } else {
      throw new Error(`api returned status ${res.status}`);
    }
  } 

  return results; 
}
