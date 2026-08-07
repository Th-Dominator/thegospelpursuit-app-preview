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
    'bible.goToVerse': 'Verse',
    'bible.video': 'Video',
    'bible.videoHint': 'Paste a YouTube, Vimeo, or video link',
    'bible.videoPost': 'Post',
    'bible.videoRemove': 'Remove',
    'bible.videoInvalid': 'That doesn’t look like a video link.',
    'bible.context': 'Context & meaning',
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
    'settings.mainVersion': 'My main Bible version',
    'settings.readingHeading': 'Reading',
    'settings.readingHint': 'How the chapter reader looks and what it shows alongside each verse.',
    'settings.fontSizeLabel': 'Font size',
    'settings.fontSmall': 'Small',
    'settings.fontMedium': 'Medium',
    'settings.fontLarge': 'Large',
    'settings.fontXLarge': 'Extra large',
    'settings.redLettersLabel': 'Show the words of Jesus in red',
    'settings.versePickerLabel': 'Show the verse picker in the reader',
    'settings.progressBarLabel': 'Show the reading progress bar',
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
    'error.serverStatus': 'Couldn’t reach the server ({status}). Please try again.',

    /* ---- chapter guide (reader) ---- */
    'bible.chapterGuide': 'Chapter guide',
    'bible.chapterGuideHint': 'Overview · how it points to Jesus · background',
    'bible.overview': 'Chapter overview',
    'bible.pointsToChrist': 'How it points to Jesus',
    'bible.background': 'History & background',
    'bible.guideBusy': 'Preparing the chapter guide…',
    'bible.guideUnavailable': 'The chapter guide isn’t available right now.',

    /* ---- the road to apologetics (journey) ---- */
    'apologetics.journeyHeading': 'The Road to Apologetics',
    'apologetics.journeyLede': 'Walk the road one stage at a time. Each stage prepares you to answer a real question — finish it to unlock the next.',
    'apologetics.rankLabel': 'Rank',
    'apologetics.levelLabel': 'Level {n}',
    'apologetics.xpLabel': '{n} XP',
    'apologetics.stationsDone': '{done} of {total} stages',
    'apologetics.locked': 'Locked',
    'apologetics.lockedHint': 'Finish the stage before this one to unlock it.',
    'apologetics.startHere': 'Start here',
    'apologetics.prepare': 'Prepare the answer',
    'apologetics.preparing': 'Preparing…',
    'apologetics.markComplete': 'Mark this stage complete',
    'apologetics.stageDone': 'Completed',
    'apologetics.resetProgress': 'Reset my progress',
    'apologetics.resetConfirm': 'Start the road over from the beginning?',
    'apologetics.askHeading': 'Ask your own question',
    'apologetics.rankSeeker': 'Seeker',
    'apologetics.rankStudent': 'Student',
    'apologetics.rankDefender': 'Defender',
    'apologetics.rankApologist': 'Apologist',
    'apologetics.rankAmbassador': 'Ambassador',
    'apologetics.complete': 'Road complete — you’re ready to give an answer. (1 Peter 3:15)',
    'apologetics.st1.title': 'Does God exist?',
    'apologetics.st2.title': 'Can I trust the Bible?',
    'apologetics.st3.title': 'Who is Jesus, really?',
    'apologetics.st4.title': 'Did Jesus rise from the dead?',
    'apologetics.st5.title': 'If God is good, why is there suffering?',
    'apologetics.st6.title': 'Isn’t faith just blind belief?',
    'apologetics.st7.title': 'Aren’t all religions basically the same?',
    'apologetics.st8.title': 'Doesn’t science disprove God?',
    'apologetics.st9.title': 'Why do Christians say Jesus is the only way?',
    'apologetics.st10.title': 'How do I share this with someone?',

    /* ---- bible plans ---- */
    'plans.year': 'The Bible in a Year',
    'plans.yearHint': 'The whole Bible, about three chapters a day',
    'plans.chrono': 'Chronological',
    'plans.chronoHint': 'Scripture in the order the events happened',
    'plans.book': 'One Book at a Time',
    'plans.bookHint': 'Read a single book straight through',
    'plans.dayCount': '{n} days',
    'plans.openPlan': 'Open plan',
    'plans.allPlans': 'All plans',
    'plans.day': 'Day {n}',
    'plans.todayHeading': 'Next up',
    'plans.readNow': 'Read now',
    'plans.markRead': 'Mark read',
    'plans.readDone': 'Read',
    'plans.daysDone': '{done} of {total} days',
    'plans.resetPlan': 'Reset this plan',
    'plans.resetConfirm': 'Clear your progress on this plan?',
    'plans.pickBook': 'Choose a book to read through',
    'plans.finished': 'Plan complete — well done!',

    /* ---- tips for new believers ---- */
    'nav.tips': 'New believers',
    'home.tipsLabel': 'Tips for new believers',
    'home.tipsHint': 'Where to start when faith is new',
    'tips.eyebrow': 'new believers',
    'tips.title': 'Tips for new believers',
    'tips.lede': 'If following Jesus is new to you, start here. A few simple things help faith take root and grow.',
    'tips.t1.title': 'Start with the Gospels',
    'tips.t1.body': 'Read the life of Jesus first — the book of John or Mark is a good place to begin. Everything else in the Bible makes more sense once you know him.',
    'tips.t2.title': 'Talk to God daily',
    'tips.t2.body': 'Prayer is simply honest conversation with God. You don’t need special words — thank him, ask him for help, and tell him what’s on your heart.',
    'tips.t3.title': 'Read a little every day',
    'tips.t3.body': 'A few verses a day beats a rushed marathon. Use a plan, and let one true thing sink in rather than skimming many.',
    'tips.t4.title': 'Find a church family',
    'tips.t4.body': 'Faith grows best in company. Look for a Bible-teaching church where you can worship, ask questions, and be known.',
    'tips.t5.title': 'It’s okay to have questions',
    'tips.t5.body': 'Doubts aren’t the opposite of faith — they’re part of the journey. Bring them into the light. The Road to Apologetics in this app is built for exactly that.',
    'tips.t6.title': 'Grace, not performance',
    'tips.t6.body': 'You’re accepted because of what Jesus did, not how well you perform. When you fall, come back — his mercy is new every morning.',
    'tips.t7.title': 'Obey the next small step',
    'tips.t7.body': 'You don’t have to change everything at once. Ask God for the one next step, and take it. Faith grows by walking.',
    'tips.t8.title': 'Tell someone',
    'tips.t8.body': 'Share what’s happening in you with a trusted friend or believer. Saying it out loud makes it real and invites others to walk with you.'
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
