# Translator

Performs in page translation using the Google Translate API. Requires an API key from the Google Cloud Platform.

__Staying Under 500,000 Characters__

The [free tier](https://cloud.google.com/translate/pricing?hl=en_US) for Google Translate API is limited to 500,000 characters per month. The addon will make a best effort 
to keep track of how many characters are submitted to the translation API. You should set approprate limits with a 
generous margin in the options to avoid charges. The addon will automatically reset the character statistics at the 
start of each month.

Translated strings are cached. If translation is disabled due to exceeding the "disable after" threshold, strings in
the cache will still be translated.

## Building

`gulp watch` will lint JS and compile SCSS during development.

To build the addon, run `gulp dist`. An XPI file will be produced in the `dist` folder.