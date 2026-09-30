// Maps are authored for one team and mirrored for the other: a half-turn about the centre, so
// (x, z) becomes (-x, -z). Anything marked `mid` sits on the centre and isn't copied.
//
//   room     { x0, x1, z0, z1, h, floor }   walls, ceiling and (unless floor is false) a floor slab
//   blocks   { min, max, mat }              mat: wall, ledge, floor, dark, glass, emulsion
//   props    { type, pos, size, rot }       crate, steel, plank; pos is the bottom centre
//   plates   { pos, size: [w, d], need, max }
//   spawns   { pos, yaw }                   team 0's; team 1 gets the mirrored ones
//   lights, decor                           looks only
const LETTERS = 'ABCDEFG';

const flipPos = p => [-p[0], p[1], -p[2]];
const flipBox = b => ({ ...b, min: [-b.max[0], b.min[1], -b.max[2]], max: [-b.min[0], b.max[1], -b.min[2]] });

export function expandMap(src) {
  const def = JSON.parse(JSON.stringify(src));
  const both = (list, flip) => {
    const out = [];
    for (const it of list || []) { out.push(it); if (def.mirror !== false && !it.mid) out.push(flip(it)); }
    return out;
  };
  def.blocks = both(src.blocks, flipBox);
  def.props = both(src.props, p => ({ ...p, pos: flipPos(p.pos), rot: (p.rot || 0) + 180 }));
  def.plates = both(src.plates, p => ({ ...p, pos: flipPos(p.pos) }));
  def.lights = both(src.lights, l => ({ ...l, pos: flipPos(l.pos) }));
  def.decor = both(src.decor, d => {
    const o = { ...d, rot: (d.rot || 0) + 180 };
    if (d.pos) o.pos = flipPos(d.pos);
    if (d.from) { o.from = flipPos(d.from); o.to = flipPos(d.to); }
    if (d.team != null) o.team = 1 - d.team;
    return o;
  });
  // plates are lettered left to right as the first team sees them (looking down +z, +x is on the left)
  def.plates.sort((a, b) => b.pos[0] - a.pos[0] || a.pos[2] - b.pos[2]);
  def.plates.forEach((p, i) => { p.name = LETTERS[i]; });
  def.spawns = [src.spawns, src.spawns.map(s => ({ pos: flipPos(s.pos), yaw: s.yaw + 180 }))];
  def.killY = src.killY ?? -8;
  return def;
}
