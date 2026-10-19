import { hash } from '../core/rng';
import { POI_SPACING } from './poislots';

/**
 * PLACE NAMES: what every roadside stop is called.
 *
 * Written by hand, not strung from syllables: a name has to read as a word somebody
 * once said out loud — odd, dusty, a little sorry for itself — and random letters never
 * do. 240 of them, every one distinct.
 *
 * Handed out per seed: each world shuffles the list once, and a stop takes the entry at
 * its roadside slot's number. Neighbouring stops therefore never share a name, and the
 * same name comes round again only 240 slots (over 1 800 km) on. Pure in (seed, s).
 */
export const PLACE_NAMES: readonly string[] = [
  'Dustwell', 'Kettlebend', 'Old Marrow', 'Sorry Flats', 'Little Thirst', 'Copper Yawn',
  'Saltpenny', 'Gravelorn', 'Mule Hollow', 'Last Biscuit', 'Hob’s Rest', 'Tinderly',
  'Crookwater', 'Pennyroad', 'Dry Ankle', 'Bramblestone', 'Oddmoor', 'Sundry',
  'Blister Creek', 'Rattlesby', 'Quill Junction', 'Hollow Spoon', 'Marrowgate', 'Glumly',
  'Whistle Pan', 'Cinder Cross', 'Lazy Anvil', 'Ditchmore', 'Crumble', 'Fennick',
  'Halfmile', 'Saddlebrook', 'Wenderby', 'Gritch', 'Tumble Down', 'Mossless',
  'Brassfield', 'Scorchwell', 'Nettleby', 'Barrow End', 'Grimsby Wash', 'Thimble',
  'Cracked Pot', 'Loamshire', 'Bellows', 'Hushwater', 'Rustle', 'Gaunt Ridge',
  'Puddleby Dry', 'Fairly', 'Snoring Mesa', 'Pickle Well', 'Dunmore', 'Orrin’s Gap',
  'Witherby', 'Clatter', 'Low Hope', 'High Hope', 'Middling', 'Second Chance',
  'Biscuit Tin', 'Graveyard Hill', 'Mudlark', 'Quietus', 'Sparrowgrass', 'Tolly',
  'Hatchet Flat', 'Dimwell', 'Ember', 'Ashby Thirst', 'Sallow', 'Kipling Wash',
  'Button', 'Lantern', 'Furrow', 'Bitterroot', 'Cobble', 'Yonder',
  'Nowhere Much', 'Wishbone', 'Dog Ear', 'Teapot Rock', 'Shallowford', 'Barley',
  'Grumble', 'Tansy', 'Mayhap', 'Cold Supper', 'Sixpence', 'Ricketty',
  'Hogsback', 'Fiddle Creek', 'Stillwater Dry', 'Pockmark', 'Dawdle', 'Gallows Pass',
  'Inkwell', 'Fallow', 'Sorrel', 'Brimstone', 'Underhill', 'Overby',
  'Crowfoot', 'Peppercorn', 'Hollowell', 'Stray Dog', 'Dusk', 'Morrow',
  'Wicket', 'Bunting', 'Harrow', 'Muddle', 'Jangle', 'Scarcely',
  'Knotwood', 'Parchment', 'Thistledown', 'Gloaming', 'Rook’s Nest', 'Badger Gap',
  'Doldrum', 'Larkspur', 'Coal Bucket', 'Tin Whistle', 'Pinchgut', 'Haggle',
  'Slumber', 'Quarry End', 'Wheelwright', 'Spindle', 'Ochre', 'Brittle',
  'Pumice', 'Cauldron', 'Fumble', 'Ladle', 'Rasp', 'Withy',
  'Snuffbox', 'Treacle', 'Grindle', 'Hearthless', 'Sundown Store', 'Weary',
  'Pilgrim Wash', 'Cactus Elbow', 'Mirage', 'Two Wells', 'Three Goats', 'Nine Mile',
  'Long Pause', 'Short Wait', 'Patience', 'Bygone', 'Forsook', 'Mended',
  'Bucket', 'Hobble', 'Waddle', 'Drowse', 'Flint', 'Grit',
  'Kiln', 'Marl', 'Tallow', 'Whitlow', 'Ninepin', 'Skillet',
  'Burdock', 'Chaff', 'Gorse', 'Heath', 'Loess', 'Scree',
  'Spur', 'Tor', 'Wold', 'Butte Lonely', 'Mesa Verdict', 'Sandpiper',
  'Rattlecan', 'Rumble', 'Shingle', 'Tumbleweed', 'Vagrant', 'Wanderwell',
  'Ambling', 'Breadcrumb', 'Candlewick', 'Dandelion', 'Eggshell', 'Fishbone Dry',
  'Gooseneck', 'Hairpin', 'Icicle', 'Jackdaw', 'Kingfisher', 'Lockjaw',
  'Molasses', 'Nutmeg', 'Oddsock', 'Pinwheel', 'Quagmire', 'Ragwort',
  'Saltlick', 'Teaspoon', 'Umber', 'Vinegar Hill', 'Wagtail', 'Yarrow',
  'Zephyr', 'Ashcan', 'Bootlace', 'Cobweb', 'Driftwood', 'Earwig',
  'Foxglove', 'Gumdrop', 'Hiccup', 'Inchworm', 'Jumble', 'Kerfuffle',
  'Limpet', 'Mothball', 'Noodle', 'Oxbow', 'Paperweight', 'Quibble',
  'Ramshackle', 'Sixty Steps', 'Tuppence', 'Upwind', 'Vesper', 'Wormwood',
  'Yawning Gap', 'Zigzag', 'Buttercup Dry', 'Cartwheel', 'Dovetail', 'Elbow Bend',
];

const NAME_TAG = 0x504c4e31; // 'PLN1'
const orders = new Map<number, number[]>();

/** The seed's shuffle of the list, built once. */
function order(seed: number): number[] {
  let shuffled = orders.get(seed);
  if (shuffled) return shuffled;
  shuffled = PLACE_NAMES.map((_, i) => i);
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = hash(seed, NAME_TAG, i) % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  orders.set(seed, shuffled);
  return shuffled;
}

/** The name of the roadside stop at arclength `s` (its slot's `Poi.s`). */
export function placeNameAt(seed: number, s: number): string {
  const slot = Math.round(s / POI_SPACING);
  const shuffled = order(seed);
  return PLACE_NAMES[shuffled[slot % shuffled.length]!]!;
}
