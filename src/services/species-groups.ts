/**
 * Grouping species for the hotkey counts. The AI can name any of its 81 species, but Quick Classify only has nine keys,
 * so a species without its own key is counted under a "Bird" key (if it is a bird) or an "Other" key.
 * The tag itself is never changed: exports keep the exact species.
 */

/** Lower case, no macrons or accents, letters and digits only: "Kererū" and "kereru" compare equal. */
export function normalizeSpecies(name: string): string {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The AI's bird species (Alita 3.03): class, common, scientific and te reo Māori names. */
const BIRD_NAMES = [
  'banded dotterel', 'Banded Dotterel', 'Charadrius bicinctus', 'Tūturiwhatu',
  'banded rail', 'Banded Rail', 'Hypotaenidia philippensis', 'Moho Pererū',
  'bellbird', 'Bellbird', 'Anthornis melanura', 'Korimako',
  'black backed gull', 'Black Backed Gull', 'Larus dominicanus', 'Karoro',
  'black billed gull', 'Black Billed Gull', 'Chroicocephalus bulleri', 'Tarāpuka',
  'black fronted tern', 'Black Fronted Tern', 'Chlidonias albostriatus', 'Tarapirohe',
  'blackbird', 'Blackbird', 'Turdus merula', 'Manu Pango',
  'brown creeper', 'Brown Creeper', 'Mohoua novaeseelandiae', 'Pīpipi',
  'canada goose', 'Canada Goose', 'Branta canadensis', 'Kuihi',
  'chicken', 'Chicken', 'Gallus gallus domesticus', 'Heihei',
  'crake', 'Crake', 'Porzana spp.', 'Kotoreke',
  'dunnock', 'Dunnock', 'Prunella modularis', '(Dunnock)',
  'fantail', 'Fantail', 'Rhipidura fuliginosa', 'Pīwakawaka',
  'fernbird', 'Fernbird', 'Poodytes punctatus', 'Mātātā',
  'finch', 'Finch', 'Fringillidae spp.', '(Finch)',
  'fiordland crested penguin', 'Fiordland Crested Penguin', 'Eudyptes pachyrhynchus', 'Tawaki',
  'grey warbler', 'Grey Warbler', 'Gerygone igata', 'Riroriro',
  'harrier', 'Harrier', 'Circus approximans', 'Kāhu',
  'kaka', 'Kaka', 'Nestor meridionalis', 'Kākā',
  'kakapo', 'Kakapo', 'Strigops habroptilus', 'Kākāpō',
  'kea', 'Kea', 'Nestor notabilis',
  'kereru', 'Kereru', 'Hemiphaga novaeseelandiae', 'Kererū',
  'kiwi', 'Kiwi', 'Apteryx spp.',
  'little blue penguin', 'Little Blue Penguin', 'Eudyptula minor', 'Kororā',
  'long tailed cuckoo', 'Long Tailed Cuckoo', 'Eudynamys taitensis', 'Koekoeā',
  'magpie', 'Magpie', 'Gymnorhina tibicen', 'Makipai',
  'mallard', 'Mallard', 'Anas platyrhynchos',
  'morepork', 'Morepork', 'Ninox novaeseelandiae', 'Ruru',
  'myna', 'Myna', 'Acridotheres tristis',
  'nz falcon', 'NZ Falcon', 'Falco novaeseelandiae', 'Kārearea',
  'oystercatcher', 'Oystercatcher', 'Haematopus spp.', 'Tōrea',
  'paradise duck', 'Paradise Duck', 'Tadorna variegata', 'Pūtangitangi',
  'parakeet', 'Parakeet', 'Cyanoramphus spp.', 'Kākāriki',
  'pateke', 'Pateke', 'Anas chlorotis', 'Pāteke',
  'pheasant', 'Pheasant', 'Phasianus colchicus', 'Peihana',
  'pipit', 'Pipit', 'Anthus novaeseelandiae', 'Pīhoihoi',
  'pukeko', 'Pukeko', 'Porphyrio melanotus', 'Pūkeko',
  'quail', 'Quail', 'Callipepla californica / Synoicus ypsilophorus', 'Tikaokao',
  'redpoll', 'Redpoll', 'Acanthis flammea', '(Redpoll)',
  'rifleman', 'Rifleman', 'Acanthisitta chloris', 'Tītitipounamu',
  'robin', 'Robin', 'Petroica australis', 'Toutouwai/Kakaruai',
  'rosella', 'Rosella', 'Platycercus spp.', 'Kākā uhi whero',
  'shore plover', 'Shore Plover', 'Thinornis novaeseelandiae', 'Tuturuatu',
  'silvereye', 'Silvereye', 'Zosterops lateralis', 'Tauhou',
  'sparrow', 'Sparrow', 'Passer domesticus', 'Tiu',
  'spurwing plover', 'Spur-winged Plover', 'Vanellus miles', '(Spur-winged Plover)',
  'starling', 'Starling', 'Sturnus vulgaris', 'Tāringi',
  'stilt', 'Stilt', 'Himantopus spp.', 'Poaka/Kakī',
  'swan', 'Swan', 'Cygnus atratus', 'Kakīānau',
  'takahe', 'Takahe', 'Porphyrio hochstetteri', 'Takahē',
  'thrush', 'Thrush', 'Turdus philomelos', 'Piopio',
  'tieke', 'Tieke', 'Callaeas spp.', 'Tīeke',
  'tomtit', 'Tomtit', 'Petroica macrocephala', 'Miromiro',
  'tui', 'Tui', 'Prosthemadera novaeseelandiae', 'Tūī',
  'weka', 'Weka', 'Gallirallus australis',
  'white faced heron', 'White Faced Heron', 'Egretta novaehollandiae', 'Matuku moana',
  'wrybill', 'Wrybill', 'Anarhynchus frontalis', 'Ngutu pare',
  'yellow eyed penguin', 'Yellow Eyed Penguin', 'Megadyptes antipodes', 'Hoiho',
  'yellowhammer', 'Yellowhammer', 'Emberiza citrinella', 'Hurukōwhai',
];

const BIRDS = new Set(BIRD_NAMES.map(normalizeSpecies));

export function isBird(species: string): boolean {
  return BIRDS.has(normalizeSpecies(species));
}

const BIRD_KEYS = new Set(['bird', 'birds']);
const OTHER_KEYS = new Set(['other', 'others']);

/**
 * Counts per hotkey species. A tag that matches a key (ignoring case and macrons) counts there; any other tag counts
 * under the "Bird"/"Birds" key when it is a bird and such a key exists, otherwise under "Other"/"Others" if there is one.
 * "Empty" is never grouped.
 */
export function hotkeyCounts(keySpecies: string[], tagCounts: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {};
  const keyByName = new Map<string, string>();
  for (const key of keySpecies) {
    result[key] = 0;
    keyByName.set(normalizeSpecies(key), key);
  }
  const birdKey = keySpecies.find(k => BIRD_KEYS.has(normalizeSpecies(k)));
  const otherKey = keySpecies.find(k => OTHER_KEYS.has(normalizeSpecies(k)));

  for (const [tag, count] of Object.entries(tagCounts)) {
    const name = normalizeSpecies(tag);
    if (!name || name === 'empty') continue;
    const target = keyByName.get(name) ?? (isBird(tag) && birdKey ? birdKey : otherKey);
    if (target) result[target] += count;
  }
  return result;
}
