/**
 * The string tables. English is the reference: its keys are the message ids, and every
 * other table is checked against it by the type.
 *
 * `postcard.message` is the note from home. The Russian is the owner's own wording; the
 * rest translate it as a parent would write it, casual and warm. Котёна is a pet name,
 * so it is carried over as a name rather than translated.
 */

const en = {
  'postcard.message':
    'Son, Kotyona and I bought a house by the sea, come visit us sometime, it’s pure bliss here! ' +
    'Drive or fly in - the main thing is, take care of yourself. We love you and we’re waiting for you any time!',
};

export type MessageKey = keyof typeof en;
type Table = Readonly<Record<MessageKey, string>>;

export const STRINGS: Readonly<Record<import('./i18n').Locale, Table>> = {
  en,
  ru: {
    'postcard.message':
      'Сынок, мы с Котёной купили дом у моря, навести нас как-нибудь, тут такой кайф! ' +
      'Приезжай или прилетай - главное, береги себя. Любим тебя и ждём в любое время!',
  },
  es: {
    'postcard.message':
      'Hijo, Kotiona y yo nos hemos comprado una casa junto al mar, ven a vernos algún día, ¡esto es una gozada! ' +
      'Ven en coche o en avión - lo principal es que te cuides. ¡Te queremos y te esperamos cuando quieras!',
  },
  pt: {
    'postcard.message':
      'Filho, eu e a Kotiona compramos uma casa na praia, vem visitar a gente qualquer dia, aqui é uma delícia! ' +
      'Vem de carro ou de avião - o importante é se cuidar. Te amamos e te esperamos a qualquer hora!',
  },
  fr: {
    'postcard.message':
      'Mon fils, Kotiona et moi avons acheté une maison au bord de la mer, viens nous voir un de ces jours, c’est le pied ici ! ' +
      'Viens en voiture ou en avion - l’essentiel, c’est de prendre soin de toi. On t’aime et on t’attend quand tu veux !',
  },
  de: {
    'postcard.message':
      'Mein Junge, Kotjona und ich haben ein Haus am Meer gekauft, besuch uns doch mal, hier ist es herrlich! ' +
      'Komm mit dem Auto oder mit dem Flieger - Hauptsache, pass auf dich auf. Wir haben dich lieb und warten jederzeit auf dich!',
  },
  it: {
    'postcard.message':
      'Figliolo, io e Kotiona abbiamo comprato una casa al mare, vieni a trovarci qualche volta, qui è una meraviglia! ' +
      'Vieni in macchina o in aereo - l’importante è che ti riguardi. Ti vogliamo bene e ti aspettiamo quando vuoi!',
  },
  pl: {
    'postcard.message':
      'Synku, kupiliśmy z Kotioną dom nad morzem, odwiedź nas kiedyś, tu jest bosko! ' +
      'Przyjedź albo przyleć - najważniejsze, uważaj na siebie. Kochamy Cię i czekamy na Ciebie o każdej porze!',
  },
  tr: {
    'postcard.message':
      'Oğlum, Kotyona ile deniz kenarında bir ev aldık, bir ara bizi ziyarete gel, burası harika! ' +
      'Arabayla ya da uçakla gel - önemli olan kendine iyi bakman. Seni seviyoruz, ne zaman istersen bekliyoruz!',
  },
  zh: {
    'postcard.message':
      '儿子，我和科乔娜在海边买了一栋房子，有空来看看我们，这里太舒服了！' +
      '开车来或者坐飞机来都行——最重要的是照顾好自己。我们爱你，随时等你回来！',
  },
  ja: {
    'postcard.message':
      '息子へ。コチョーナと海辺に家を買ったよ。いつか遊びにおいで、ここは最高だよ！' +
      '車でも飛行機でもいい、とにかく体に気をつけてね。愛してるよ、いつでも待ってるからね！',
  },
  ko: {
    'postcard.message':
      '아들아, 코툐나랑 바닷가에 집을 샀단다. 언제 한번 놀러 오렴, 여기 정말 좋아! ' +
      '차로 오든 비행기로 오든 - 제일 중요한 건 몸 조심하는 거야. 사랑한다, 언제든 기다리고 있을게!',
  },
};
