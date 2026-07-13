/**
 * One-time seed data for the starter deck.
 *
 * Run `seedCards` from the editor (or open the web app with `?action=seed`)
 * to load these into an empty `cards` sheet. It is idempotent: if the sheet
 * already has data rows it does nothing.
 *
 * If you previously loaded the OLD starter deck (with dutch/meaning/example
 * columns), run `resetAndReseed` instead — it clears the sheet and reloads
 * with the current front_side / back_side / notes schema.
 *
 * Source rows are [id, type, front_side, meaning, example, example_meaning,
 * notes]; seedCards composes a Markdown back_side from meaning + example.
 */

var SEED_ROWS = [
  [1, 'vocab', 'het huis', 'the house', 'Ik woon in een groot huis.', 'I live in a big house.', 'het-word'],
  [2, 'vocab', 'de man', 'the man', 'De man leest een boek.', 'The man is reading a book.', 'de-word'],
  [3, 'vocab', 'de vrouw', 'the woman', 'De vrouw drinkt koffie.', 'The woman is drinking coffee.', 'de-word'],
  [4, 'vocab', 'het kind', 'the child', 'Het kind speelt buiten.', 'The child is playing outside.', 'het-word; plural: kinderen'],
  [5, 'vocab', 'de dag', 'the day', 'Fijne dag!', 'Have a nice day!', 'de-word'],
  [6, 'vocab', 'de nacht', 'the night', 'Welterusten en goedenacht.', 'Good night.', 'de-word'],
  [7, 'vocab', 'het water', 'the water', 'Mag ik een glas water?', 'May I have a glass of water?', 'het-word'],
  [8, 'vocab', 'het brood', 'the bread', 'Ik eet brood met kaas.', 'I eat bread with cheese.', 'het-word'],
  [9, 'vocab', 'de kaas', 'the cheese', 'Nederlandse kaas is lekker.', 'Dutch cheese is delicious.', 'de-word'],
  [10, 'vocab', 'de koffie', 'the coffee', 'Ik drink graag koffie.', 'I like to drink coffee.', 'de-word'],
  [11, 'vocab', 'de melk', 'the milk', 'De melk is op.', 'The milk is finished.', 'de-word'],
  [12, 'vocab', 'het geld', 'the money', 'Ik heb geen geld bij me.', "I don't have money on me.", 'het-word'],
  [13, 'vocab', 'de tijd', 'the time', 'Ik heb geen tijd.', "I don't have time.", 'de-word'],
  [14, 'vocab', 'het werk', 'the work / job', 'Ik ga naar mijn werk.', "I'm going to work.", 'het-word'],
  [15, 'vocab', 'de school', 'the school', 'De kinderen gaan naar school.', 'The children go to school.', 'de-word'],
  [16, 'vocab', 'de stad', 'the city', 'Amsterdam is een mooie stad.', 'Amsterdam is a beautiful city.', 'de-word; plural: steden'],
  [17, 'vocab', 'het land', 'the country', 'Nederland is een klein land.', 'The Netherlands is a small country.', 'het-word'],
  [18, 'vocab', 'de straat', 'the street', 'Ik woon in deze straat.', 'I live on this street.', 'de-word'],
  [19, 'vocab', 'de auto', 'the car', 'Mijn auto is kapot.', 'My car is broken.', 'de-word'],
  [20, 'vocab', 'de fiets', 'the bicycle', 'Ik ga met de fiets.', 'I go by bike.', 'de-word'],
  [21, 'vocab', 'de trein', 'the train', 'De trein is te laat.', 'The train is late.', 'de-word'],
  [22, 'vocab', 'het boek', 'the book', 'Dit boek is interessant.', 'This book is interesting.', 'het-word'],
  [23, 'vocab', 'de vriend', 'the friend (m)', 'Hij is mijn beste vriend.', 'He is my best friend.', 'de-word; f: vriendin'],
  [24, 'vocab', 'de familie', 'the family', 'Mijn familie woont ver weg.', 'My family lives far away.', 'de-word'],
  [25, 'vocab', 'de moeder', 'the mother', 'Mijn moeder kookt lekker.', 'My mother cooks well.', 'de-word'],
  [26, 'vocab', 'de vader', 'the father', 'Mijn vader werkt hard.', 'My father works hard.', 'de-word'],
  [27, 'vocab', 'groot', 'big / large', 'Dat is een groot probleem.', 'That is a big problem.', 'adjective'],
  [28, 'vocab', 'klein', 'small', 'Ik heb een kleine vraag.', 'I have a small question.', 'adjective'],
  [29, 'vocab', 'goed', 'good', 'Alles is goed.', 'Everything is fine.', 'adjective/adverb'],
  [30, 'vocab', 'slecht', 'bad', 'Het weer is slecht.', 'The weather is bad.', 'adjective'],
  [31, 'vocab', 'mooi', 'beautiful / nice', 'Wat een mooie dag!', 'What a beautiful day!', 'adjective'],
  [32, 'vocab', 'nieuw', 'new', 'Ik heb een nieuwe telefoon.', 'I have a new phone.', 'adjective'],
  [33, 'vocab', 'oud', 'old', 'Dit is een oud gebouw.', 'This is an old building.', 'adjective'],
  [34, 'vocab', 'lekker', 'tasty / nice', 'Het eten is erg lekker.', 'The food is very tasty.', 'common Dutch word'],
  [35, 'vocab', 'duur', 'expensive', 'Deze jas is te duur.', 'This coat is too expensive.', 'adjective'],
  [36, 'vocab', 'goedkoop', 'cheap', 'Dit is heel goedkoop.', 'This is very cheap.', 'adjective'],
  [37, 'vocab', 'snel', 'fast / quick', 'Hij loopt heel snel.', 'He walks very fast.', 'adjective/adverb'],
  [38, 'vocab', 'langzaam', 'slow', 'Rijd niet te langzaam.', "Don't drive too slowly.", 'adjective/adverb'],
  [39, 'vocab', 'moeilijk', 'difficult', 'Nederlands is niet moeilijk.', 'Dutch is not difficult.', 'adjective'],
  [40, 'vocab', 'makkelijk', 'easy', 'Dat is makkelijk.', 'That is easy.', 'also: gemakkelijk'],
  [41, 'vocab', 'zijn', 'to be', 'Ik ben moe.', 'I am tired.', 'irregular: ben/bent/is/zijn'],
  [42, 'vocab', 'hebben', 'to have', 'Wij hebben een hond.', 'We have a dog.', 'irregular: heb/hebt/heeft/hebben'],
  [43, 'vocab', 'gaan', 'to go', 'Ik ga naar huis.', "I'm going home.", 'irregular: ga/gaat/gaan'],
  [44, 'vocab', 'komen', 'to come', 'Zij komt morgen.', 'She comes tomorrow.', 'irregular: kom/komt/komen'],
  [45, 'vocab', 'doen', 'to do', 'Wat doe je?', 'What are you doing?', 'irregular: doe/doet/doen'],
  [46, 'vocab', 'maken', 'to make', 'Ik maak het eten.', "I'm making the food.", 'regular verb'],
  [47, 'vocab', 'zeggen', 'to say', 'Wat zeg je?', 'What are you saying?', 'zei (past)'],
  [48, 'vocab', 'zien', 'to see', 'Ik zie je later.', "I'll see you later.", 'zag (past)'],
  [49, 'vocab', 'weten', 'to know (a fact)', 'Ik weet het niet.', "I don't know.", 'vs kennen (know a person)'],
  [50, 'vocab', 'kennen', 'to know (be familiar)', 'Ik ken hem niet.', "I don't know him.", 'vs weten (know a fact)'],
  [51, 'vocab', 'willen', 'to want', 'Ik wil naar huis.', 'I want to go home.', 'modal verb'],
  [52, 'vocab', 'kunnen', 'to be able to / can', 'Kun je me helpen?', 'Can you help me?', 'modal verb'],
  [53, 'vocab', 'moeten', 'to must / have to', 'Ik moet werken.', 'I have to work.', 'modal verb'],
  [54, 'vocab', 'mogen', 'to be allowed to / may', 'Mag ik binnenkomen?', 'May I come in?', 'modal verb'],
  [55, 'vocab', 'eten', 'to eat', 'Wij eten om zes uur.', "We eat at six o'clock.", 'at (past)'],
  [56, 'vocab', 'drinken', 'to drink', 'Ik drink thee.', 'I drink tea.', 'dronk (past)'],
  [57, 'vocab', 'werken', 'to work', 'Ik werk in Amsterdam.', 'I work in Amsterdam.', 'regular verb'],
  [58, 'vocab', 'wonen', 'to live / reside', 'Waar woon je?', 'Where do you live?', 'regular verb'],
  [59, 'vocab', 'spreken', 'to speak', 'Spreek je Nederlands?', 'Do you speak Dutch?', 'sprak (past)'],
  [60, 'vocab', 'begrijpen', 'to understand', 'Ik begrijp het niet.', "I don't understand.", 'begreep (past)'],
  [61, 'vocab', 'vandaag', 'today', 'Wat doen we vandaag?', 'What are we doing today?', 'time word'],
  [62, 'vocab', 'morgen', 'tomorrow', 'Tot morgen!', 'See you tomorrow!', "also means 'morning'"],
  [63, 'vocab', 'gisteren', 'yesterday', 'Ik was gisteren ziek.', 'I was sick yesterday.', 'time word'],
  [64, 'vocab', 'nu', 'now', 'Ik kom nu.', "I'm coming now.", 'time word'],
  [65, 'vocab', 'altijd', 'always', 'Hij is altijd te laat.', 'He is always late.', 'frequency'],
  [66, 'vocab', 'nooit', 'never', 'Ik drink nooit alcohol.', 'I never drink alcohol.', 'frequency'],
  [67, 'vocab', 'soms', 'sometimes', 'Soms regent het.', 'Sometimes it rains.', 'frequency'],
  [68, 'vocab', 'vaak', 'often', 'Ik ga vaak naar de markt.', 'I often go to the market.', 'frequency'],
  [69, 'vocab', 'hier', 'here', 'Kom hier!', 'Come here!', 'place word'],
  [70, 'vocab', 'daar', 'there', 'Daar is het station.', 'There is the station.', 'place word'],
  [71, 'grammar', 'de / het', "definite article 'the'", 'het huis / de man', 'the house / the man', 'het for neuter nouns, de for common nouns; when unsure, guess de (majority)'],
  [72, 'grammar', 'een', "indefinite article 'a/an'", 'een boek / een appel', 'a book / an apple', 'same for all nouns; no gender distinction'],
  [73, 'grammar', 'word order: verb second', 'the finite verb comes in position 2', 'Morgen ga ik naar Utrecht.', 'Tomorrow I go to Utrecht.', "'Morgen' fills slot 1, so subject 'ik' moves after the verb (inversion)"],
  [74, 'grammar', 'negation: niet', "'not' negates verbs/adjectives", 'Ik ken hem niet.', "I don't know him.", 'niet usually goes at the end or before the word it negates'],
  [75, 'grammar', 'negation: geen', "'no / not a' negates indefinite nouns", 'Ik heb geen tijd.', 'I have no time.', 'use geen (not niet) before a noun with een or no article'],
  [76, 'grammar', 'plural -en', 'most nouns add -en', 'boek -> boeken; huis -> huizen', 'book -> books', 'watch spelling changes: s->z, f->v, vowel doubling'],
  [77, 'grammar', 'plural -s', 'nouns ending in -el/-en/-er/-je take -s', 'tafel -> tafels; meisje -> meisjes', 'table -> tables', 'also many loanwords take -s'],
  [78, 'grammar', 'adjective + e', 'adjective gets -e before a noun', 'de grote man / een groot huis', 'the big man / a big house', 'no -e with het-word + een (een groot huis); otherwise add -e'],
  [79, 'grammar', 'er is / er zijn', "'there is / there are'", 'Er is een probleem.', 'There is a problem.', "'er' as dummy subject for existence"],
  [80, 'grammar', 'modal + infinitief', 'modal verb sends the main verb to the end', 'Ik wil een koffie drinken.', 'I want to drink a coffee.', 'infinitive (drinken) goes to the end of the clause']
];

/** Builds the full sheet rows (with a Markdown back_side) from SEED_ROWS. */
function buildSeedRows_() {
  var today = todayStr_();
  return SEED_ROWS.map(function (r) {
    var id = r[0], type = r[1], front = r[2];
    var meaning = r[3], example = r[4], exampleMeaning = r[5], notes = r[6];

    var back = '**' + meaning + '**';
    if (example) back += '\n\n_' + example + '_';
    if (exampleMeaning) back += '\n' + exampleMeaning;

    // id, type, front_side, back_side, notes, box, due, last_seen, right, wrong, added, flag, exclude
    return [id, type, front, back, notes, '', '', '', '', '', today, '', ''];
  });
}

/** Populates the `cards` sheet if it is still empty. */
function seedCards() {
  var sheet = getSheet_();
  if (sheet.getLastRow() > 1) {
    return 'Sheet already has ' + (sheet.getLastRow() - 1) +
      ' rows. Nothing seeded. (Run resetAndReseed to wipe and reload.)';
  }
  var rows = buildSeedRows_();
  sheet.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
  return 'Seeded ' + rows.length + ' cards.';
}

/**
 * Clears the sheet completely, rewrites the header to the current schema,
 * and reloads the starter deck. Use this if you previously seeded the old
 * schema. WARNING: this deletes everything in the `cards` sheet.
 */
function resetAndReseed() {
  var sheet = getSheet_();
  sheet.clear();
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sheet.setFrozenRows(1);
  var rows = buildSeedRows_();
  sheet.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
  return 'Reset and seeded ' + rows.length + ' cards.';
}
