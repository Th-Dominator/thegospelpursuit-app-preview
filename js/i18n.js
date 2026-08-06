/* The forty languages most spoken in US homes that this app can actually serve
   end to end — the interface, the scripture, and everything Claude writes.
   `native` is what the picker shows first: people recognise their own language
   faster than its English name. `dir` is only set where it isn't 'ltr'. */
var LANGUAGES = [
  { code: 'en',    native: 'English',          english: 'English' },
  { code: 'es',    native: 'Español',          english: 'Spanish' },
  { code: 'zh',    native: '中文（简体）',       english: 'Chinese (Simplified)' },
  { code: 'zh-TW', native: '中文（繁體）',       english: 'Chinese (Traditional)' },
  { code: 'tl',    native: 'Tagalog',          english: 'Tagalog' },
  { code: 'vi',    native: 'Tiếng Việt',       english: 'Vietnamese' },
  { code: 'ar',    native: 'العربية',           english: 'Arabic', dir: 'rtl' },
  { code: 'fr',    native: 'Français',         english: 'French' },
  { code: 'ko',    native: '한국어',            english: 'Korean' },
  { code: 'ru',    native: 'Русский',          english: 'Russian' },
  { code: 'ht',    native: 'Kreyòl Ayisyen',   english: 'Haitian Creole' },
  { code: 'de',    native: 'Deutsch',          english: 'German' },
  { code: 'hi',    native: 'हिन्दी',              english: 'Hindi' },
  { code: 'pt',    native: 'Português',        english: 'Portuguese' },
  { code: 'it',    native: 'Italiano',         english: 'Italian' },
  { code: 'pl',    native: 'Polski',           english: 'Polish' },
  { code: 'ur',    native: 'اردو',              english: 'Urdu', dir: 'rtl' },
  { code: 'ja',    native: '日本語',            english: 'Japanese' },
  { code: 'fa',    native: 'فارسی',             english: 'Persian' },
  { code: 'gu',    native: 'ગુજરાતી',            english: 'Gujarati' },
  { code: 'te',    native: 'తెలుగు',             english: 'Telugu' },
  { code: 'bn',    native: 'বাংলা',              english: 'Bengali' },
  { code: 'ta',    native: 'தமிழ்',              english: 'Tamil' },
  { code: 'pa',    native: 'ਪੰਜਾਬੀ',              english: 'Punjabi' },
  { code: 'el',    native: 'Ελληνικά',         english: 'Greek' },
  { code: 'hy',    native: 'Հայերեն',          english: 'Armenian' },
  { code: 'he',    native: 'עברית',             english: 'Hebrew', dir: 'rtl' },
  { code: 'th',    native: 'ไทย',               english: 'Thai' },
  { code: 'km',    native: 'ភាសាខ្មែរ',           english: 'Khmer' },
  { code: 'lo',    native: 'ລາວ',               english: 'Lao' },
  { code: 'hmn',   native: 'Hmoob',            english: 'Hmong' },
  { code: 'am',    native: 'አማርኛ',            english: 'Amharic' },
  { code: 'so',    native: 'Soomaali',         english: 'Somali' },
  { code: 'ne',    native: 'नेपाली',             english: 'Nepali' },
  { code: 'my',    native: 'မြန်မာ',             english: 'Burmese' },
  { code: 'uk',    native: 'Українська',       english: 'Ukrainian' },
  { code: 'ro',    native: 'Română',           english: 'Romanian' },
  { code: 'nl',    native: 'Nederlands',       english: 'Dutch' },
  { code: 'tr',    native: 'Türkçe',           english: 'Turkish' },
  { code: 'id',    native: 'Bahasa Indonesia', english: 'Indonesian' }
];

/* Persian is written right to left, but the `dir` above was left off the entry
   by hand once already — deriving it from one list keeps the two in step. */
var RTL_CODES = ['ar', 'ur', 'fa', 'he'];
LANGUAGES.forEach(function (lang) {
  if (RTL_CODES.indexOf(lang.code) !== -1) lang.dir = 'rtl';
});

/* Per-language tables land here, one file each under js/lang/. English is the
   only one bundled up front: it backs every key, so a missing or half-finished
   translation degrades to English rather than to blank UI. */
var TGP_LANG = {};

/* The brand name stays "The Gospel Pursuit" everywhere, so it isn't a key. */
var TRANSLATIONS = {
  en: {
    'app.title': 'The Gospel Pursuit — scripture, devotionals, and apologetics',
    'brand.tagline': 'Walk closer, one pursuit at a time',
    'loading.cta': 'Get Started',

    'auth.tagline': 'Sign in to continue your pursuit',
    'auth.loading': 'Preparing sign in…',
    'auth.unavailable': 'Sign in isn’t available right now. Please refresh and try again.',
    'auth.notConfigured': 'Sign in isn’t set up for this app yet.',
    'auth.signedOut': 'You’re signed out.',

    'nav.label': 'Primary',
    'nav.home': 'Today',
    'nav.bible': 'The Bible',
    'nav.search': 'Search scripture',
    'nav.devotional': 'Devotional',
    'nav.plans': 'Bible plans',
    'nav.apologetics': 'The Road to Apologetics',
    'nav.settings': 'Settings',
    'app.menu': 'Menu',
    'app.signOut': 'Sign out',

    'home.eyebrow': 'verse of the day',
    'home.verseLoading': 'Loading today’s verse…',
    'home.verseUnavailable': 'Today’s verse isn’t available right now.',
    'home.bibleLabel': 'The Bible',
    'home.bibleHint': 'Read any book, chapter by chapter',
    'home.searchLabel': 'Search scripture',
    'home.searchHint': 'Look up any passage or reference',
    'home.devotionalLabel': 'Generate a devotional',
    'home.devotionalHint': 'A short reflection on any topic',
    'home.plansLabel': 'Bible plans',
    'home.plansHint': 'Read through scripture, a day at a time',
    'home.apologeticsLabel': 'The Road to Apologetics',
    'home.apologeticsHint': 'Reasoned answers to hard questions',
    'home.comingSoon': 'Coming soon',

    'bible.eyebrow': 'the bible',
    'bible.title': 'Read the Bible',
    'bible.lede': 'Choose a testament, then a book and chapter. The text appears in your chosen language wherever a translation exists.',
    'bible.book': 'Book',
    'bible.oldTestament': 'Old Testament',
    'bible.newTestament': 'New Testament',
    'bible.bookCount': '{count} books',
    'bible.back': 'Back',
    'bible.prevChapter': 'Previous',
    'bible.nextChapter': 'Next',
    'bible.chapter': 'Chapter',
    'bible.version': 'Version',
    'bible.video': 'Video',
    'bible.videoHint': 'Paste a YouTube, Vimeo, or video link',
    'bible.videoPost': 'Post',
    'bible.videoRemove': 'Remove',
    'bible.videoInvalid': 'That doesn’t look like a video link.',
    'bible.context': 'Context',
    'bible.resources': 'Resources',
    'bible.knowledgeCheck': 'Knowledge check',
    'bible.easy': 'Easy',
    'bible.medium': 'Medium',
    'bible.hard': 'Hard',
    'bible.loading': 'Loading…',
    'bible.sectionUnavailable': 'Not connected yet.',
    'bible.submit': 'Open',
    'bible.busy': 'Opening…',
    'bible.busyStatus': 'Loading that chapter…',
    'bible.unavailable': 'The Bible reader isn’t connected yet.',

    'search.eyebrow': 'search scripture',
    'search.title': 'Find a passage',
    'search.placeholder': 'John 3:16, or Romans 8',
    'search.submit': 'Search',
    'search.busy': 'Searching…',
    'search.busyStatus': 'Looking up that passage…',

    'devotional.eyebrow': 'devotional',
    'devotional.title': 'Generate a devotional',
    'devotional.placeholder': 'patience, forgiveness, Philippians 4:6',
    'devotional.submit': 'Generate',
    'devotional.busy': 'Writing…',
    'devotional.busyStatus': 'Writing your devotional…',

    'plans.eyebrow': 'bible plans',
    'plans.title': 'Read through scripture',
    'plans.lede': 'Pick a plan and work through it a day at a time. Your place is kept as you go.',
    'plans.unavailable': 'Bible plans aren’t connected yet.',

    'apologetics.eyebrow': 'the road to apologetics',
    'apologetics.title': 'Answer the hard question',
    'apologetics.lede': 'Describe the objection or question you’re facing. You’ll get the reasoning, the scripture behind it, and how to say it plainly.',
    'apologetics.placeholder': 'if God is good, why is there suffering?',
    'apologetics.submit': 'Prepare',
    'apologetics.busy': 'Preparing…',
    'apologetics.busyStatus': 'Working through the answer…',

    'settings.eyebrow': 'settings',
    'settings.title': 'Settings',
    'settings.lede': 'Set your language once, then tune how each part of the app works for you.',
    'settings.languageHeading': 'Language',
    'settings.languageHint': 'The app — and everything it writes for you, from devotionals to apologetics — will use this language.',
    'settings.bibleHeading': 'The Bible',
    'settings.bibleHint': 'Which translation to read and search when more than one exists in your language.',
    'settings.translationLabel': 'Preferred translation',
    'settings.translationDefault': 'Recommended for your language',
    'settings.searchHeading': 'Search scripture',
    'settings.searchHint': 'How much surrounding text to show with a result.',
    'settings.contextLabel': 'Context around a verse',
    'settings.contextVerse': 'Just the verse',
    'settings.contextParagraph': 'The whole paragraph',
    'settings.contextChapter': 'The whole chapter',
    'settings.devotionalHeading': 'Devotional',
    'settings.devotionalHint': 'How long a devotional should run when you generate one.',
    'settings.lengthLabel': 'Length',
    'settings.lengthShort': 'Short — a few sentences',
    'settings.lengthMedium': 'Medium — a few paragraphs',
    'settings.lengthLong': 'Long — a full study',
    'settings.plansHeading': 'Bible plans',
    'settings.plansHint': 'How much to read each day when you start a plan.',
    'settings.paceLabel': 'Daily pace',
    'settings.paceLight': 'Light — one chapter',
    'settings.paceSteady': 'Steady — two or three chapters',
    'settings.paceFull': 'Full — read the Bible in a year',
    'settings.apologeticsHeading': 'The Road to Apologetics',
    'settings.apologeticsHint': 'The register your answers are written in.',
    'settings.toneLabel': 'Tone',
    'settings.toneGentle': 'Gentle — for a friend who is asking',
    'settings.toneDirect': 'Direct — for a real debate',
    'settings.toneAcademic': 'Academic — sources and citations',
    'settings.saved': 'Saved.',

    'language.current': 'Current',
    'language.saved': 'Language set to {name}.',
    'language.loading': 'Switching language…',

    'error.server': 'Couldn’t reach the server. Check your connection and try again.',
    'error.serverStatus': 'Couldn’t reach the server ({status}). Please try again.'
  }
};

/* Fetches js/lang/<code>.js on first use and folds it into TRANSLATIONS.
   A language that fails to load resolves anyway: t() already falls through to
   English per key, so the app stays usable instead of stalling on a 404. */
var TGPi18n = (function () {
  var pending = {};

  function load(code) {
    if (TRANSLATIONS[code]) return Promise.resolve(code);
    if (pending[code]) return pending[code];

    pending[code] = new Promise(function (resolve) {
      var script = document.createElement('script');
      script.src = 'js/lang/' + code + '.js';
      script.async = true;
      script.onload = function () {
        if (TGP_LANG[code]) TRANSLATIONS[code] = TGP_LANG[code];
        resolve(code);
      };
      script.onerror = function () {
        resolve(code);
      };
      document.head.appendChild(script);
    });
    return pending[code];
  }

  return { load: load };
})();
