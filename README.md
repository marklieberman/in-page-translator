# Translator

Performs in page translation using the cloud based translation. Currently it supports Microsoft Azure's Cognitive 
Translate and Google Cloud Platform's Translate API.

__Character translation quotas and free tiers__

You can add as many translation providers as you have accounts/API tokens. The addon will make a best effort to keep 
track of how many characters are submitted to each translation API. You can set a quota to disable a provider before
the quota is exceeded. The quota will be reset on the day your billing cycle resets, which can be configured. If you 
wish to remain in the free tier for each provider, you should set approprate limits with a generous margin.

Translated strings are cached. If translation is disabled due to exceeding the "disable after" threshold, strings in
the cache will still be translated.

## Building

`gulp watch` will lint JS and compile SCSS during development.

To build the addon, run `gulp dist`. An XPI file will be produced in the `dist` folder.