import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { applyCloudShadow } from '../cloudshadow';
import { injectSeason } from '../season';
import type { LookPalette } from '../../world/look/palette';
import { groundTextures, type GroundTextureName } from './groundtextures';
import { applyWorldLighting } from './lighting';

/**
 * THE BUSHES: four crossed cards, cut out of one seasonal atlas.
 *
 * WHAT THEY ARE. The undergrowth of a wood's edge, the weeds of a road ditch and the
 * willow scrub of wet ground are the same little plant seen in three places, and they
 * are drawn the same way slowroads draws its bushes: `notes/SrGrass.md` §7 — a small
 * model of crossed cards and a 2048x512 atlas whose four slots keep the same meaning
 * in every season, so a bush is placed once and merely re-rendered. One atlas, one
 * material, one instanced draw for the whole world.
 *
 * THE TWO SEASONS ARE ONE PAIR OF SAMPLERS. Four atlases would be four texture units
 * for a plant, and a bush is never between three seasons: spring and summer, summer
 * and autumn, autumn and winter are the pairs that exist (the same construction
 * `render/look/groundmaterial.ts` uses for the four forest floors), and `setBushLook`
 * points the pair at the month's two and hands over the mix. The season channels are
 * the ground's own (`LookPalette.groundForestA/B`), so a bush and the floor under it
 * cannot disagree about what month it is.
 *
 * THE CARDS COME FROM THE ASSET. `public/look/bush.glb` holds the four crossed cards —
 * 1.6 x 1.6 m, base at the plant's own ground contact, u across one slot of the atlas —
 * and the file is authored in the asset pipeline's z-up frame (the plants' own up axis
 * is -z, the way Blender exports without the axis conversion), so it is stood up here
 * once. A slot is chosen per instance by adding a quarter to u, exactly as the grass
 * atlas is indexed.
 *
 * NO SHADOW MAP, AND THE SAME LIGHT AS THE GROUND. The tiles refuse the shadow map
 * outright (`world/terrainmesh.ts`), so a bush that took it stood in shade on a sunlit
 * verge as a dark card. A bush takes the world lighting patch, the cloud field and the
 * fog that the tufts and the ground take, and an ambient-occlusion skirt at its own
 * base — the geometry carries no vertex occlusion, and without the skirt the base of a
 * card reads as a flat hole in the grass.
 */

/** The four slots of every bush atlas, in the order the manifest declares them. */
export const BUSH_SLOT = {
  /** hazel / wild-rose scrub, and what a hazel-and-rowan edge becomes. */
  shrub: 0,
  /** tall roadside umbellifers: nettle and willowherb. */
  umbellifer: 1,
  /** bracken — a wood's floor and its edge. */
  bracken: 2,
  /** juniper and willow scrub: dry heath and wet ground alike. */
  juniper: 3,
} as const;

/** The four atlases, in `SEASON_ORDER` (`world/look/palette.ts`). */
const BUSH_ATLASES: readonly GroundTextureName[] = [
  'bushSpring',
  'bushSummer',
  'bushAutumn',
  'bushWinter',
];

/**
 * The card's own level against the photograph's. The atlases are photographed colour
 * (that is what makes a bush worth its texture unlike the grass's greyscale cut-outs),
 * so this is a level and not a tint: one number for all four slots and all four
 * seasons, measured against the ground the bush stands in.
 */
const BUSH_GAIN = 1.0;

/** How deep the base of a card is taken down, and over how much of its height. */
const BUSH_AO = 0.55;
const BUSH_AO_HEIGHT = 0.38;

/** Where a bush starts to sink and shrink into the ground, and where it is gone. */
export const BUSH_SINK_FROM_M = 70;
export const BUSH_SINK_TO_M = 135;
/** The share of a bush's size the sink takes with it (SrGrass §4: about a half). */
const BUSH_SINK_SHRINK = 0.5;
/** How deep it sinks by the end, metres at scale 1. */
const BUSH_SINK_DEPTH_M = 0.9;
/** The alpha a bush keeps at distance: 0.45 underfoot, 0.2 at the end of its reach. */
const BUSH_ALPHA_NEAR = 0.45;
const BUSH_ALPHA_FAR = 0.2;
const BUSH_ALPHA_FROM_M = 10;
const BUSH_ALPHA_TO_M = 120;

const atlasA: THREE.IUniform = { value: null as unknown as THREE.Texture };
const atlasB: THREE.IUniform = { value: null as unknown as THREE.Texture };
const atlasMix: THREE.IUniform = { value: 0 };
/** Where the camera is, scene-relative: the sink is measured from it. */
export const bushUniforms = {
  uBushAtlasA: atlasA,
  uBushAtlasB: atlasB,
  uBushMix: atlasMix,
  uBushCamRel: { value: new THREE.Vector2() },
  uOriginMod: { value: new THREE.Vector2() },
};

/**
 * This frame's two bush atlases and the mix between them, from the look palette. Called
 * once a frame beside `setGroundLook`, so a bush and the ground it stands in change
 * season on the same frame.
 */
export function setBushLook(palette: LookPalette): void {
  const textures = groundTextures();
  atlasA.value = textures[BUSH_ATLASES[palette.groundForestA] ?? 'bushSummer'];
  atlasB.value = textures[BUSH_ATLASES[palette.groundForestB] ?? 'bushSummer'];
  atlasMix.value = palette.groundForestMix;
}

/**
 * The crossed cards, from the asset. Loaded once and cached; the promise is the same
 * one for every caller, and a world that cannot fetch an asset (the headless tools)
 * simply never gets a bush layer — the same contract the ground photographs are on.
 */
let cards: Promise<THREE.BufferGeometry> | null = null;

export function loadBushCards(): Promise<THREE.BufferGeometry> {
  cards ??= (async () => {
    const scene = (await new GLTFLoader().loadAsync('/look/bush.glb')).scene;
    let source: THREE.BufferGeometry | null = null;
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!source && mesh.isMesh) source = mesh.geometry;
    });
    if (!source) throw new Error('bush.glb carries no mesh');
    const geometry = (source as THREE.BufferGeometry).clone();
    // The file is the asset pipeline's z-up frame: the plants' own up axis is -z, so a
    // quarter turn about x stands the cards up in ours (and puts their base back at y = 0).
    geometry.rotateX(Math.PI / 2);
    geometry.computeBoundingSphere();
    return geometry;
  })();
  return cards;
}

const VERTEX_PRELUDE = /* glsl */ `
attribute vec4 aBushSlot;
uniform float uBushSinkFrom;
uniform float uBushSinkTo;
uniform vec2 uBushCamRel;
varying vec2 vBushUv;
varying float vBushAo;
varying float vBushDist;
`;

const VERTEX_BODY = /* glsl */ `
#include <begin_vertex>
{
	vec2 bushAt = instanceMatrix[ 3 ].xz;
	vBushDist = length( bushAt - uBushCamRel );
	float bushK = smoothstep( uBushSinkFrom, uBushSinkTo, vBushDist );
	// Gone by the end of the reach, and never a pop: the last fifth of the sink takes
	// what is left of the card to zero size at the same rate the ground's haze covers it.
	float bushGone = smoothstep( uBushSinkTo - 0.2 * uBushSinkTo, uBushSinkTo, vBushDist );
	transformed *= aBushSlot.y * ( 1.0 - ${BUSH_SINK_SHRINK.toFixed(2)} * bushK ) * ( 1.0 - bushGone );
	// The sink goes through the ground rather than fading into it: an alpha fade would
	// leave the card standing in the air, which is what the tufts taught stage 3.
	transformed.y -= ${BUSH_SINK_DEPTH_M.toFixed(2)} * aBushSlot.y * bushK;
	// The card's own u is one slot wide; the instance says which. A flip of the slot is
	// the whole of a bush's variety at this size.
	float bushSlot = aBushSlot.x;
	float bushU = aBushSlot.z < 0.5 ? uv.x : 0.25 - uv.x;
	vBushUv = vec2( bushSlot * 0.25 + bushU, uv.y );
	vBushAo = mix( ${BUSH_AO.toFixed(2)}, 1.0, smoothstep( 0.0, ${BUSH_AO_HEIGHT.toFixed(2)}, uv.y ) ) * aBushSlot.w;
}
`;

const FRAGMENT_PRELUDE = /* glsl */ `
uniform sampler2D uBushAtlasA;
uniform sampler2D uBushAtlasB;
uniform float uBushMix;
varying vec2 vBushUv;
varying float vBushAo;
varying float vBushDist;
`;

/**
 * The alpha test rises with distance. A mip-averaged cut-out loses its thin stems to the
 * threshold and a bush dissolves rather than shrinking (SrGrass §4), so the farther it
 * is the more of a half-transparent texel is kept: 0.45 underfoot, 0.2 at the end of the
 * sink. It is a `discard`, not a blend: the card keeps the solid alpha it has, and
 * nothing has to be sorted.
 */
const FRAGMENT_BODY = /* glsl */ `
${THREE.ShaderChunk.color_fragment}
{
	vec4 bushA = texture2D( uBushAtlasA, vBushUv );
	vec4 bushB = texture2D( uBushAtlasB, vBushUv );
	vec4 bush = mix( bushA, bushB, uBushMix );
	float bushCut = mix( ${BUSH_ALPHA_NEAR.toFixed(2)}, ${BUSH_ALPHA_FAR.toFixed(2)},
		clamp( ( vBushDist - ${BUSH_ALPHA_FROM_M.toFixed(1)} ) / ${(BUSH_ALPHA_TO_M - BUSH_ALPHA_FROM_M).toFixed(1)}, 0.0, 1.0 ) );
	if ( bush.a < bushCut ) discard;
	diffuseColor.rgb = bush.rgb * ${BUSH_GAIN.toFixed(3)} * vBushAo;
	diffuseColor.a = 1.0;
}
`;

/**
 * The bush material. `MeshStandardMaterial` so the sun, the sky, the cloud field, the
 * fog and the tone mapping keep working, patched with the world lighting and cut out
 * per fragment. Depth is written: a bush is a solid thing in the field, unlike a tuft,
 * and two of them meeting must sort by the depth buffer rather than by draw order.
 */
export function bushMaterial(): THREE.MeshStandardMaterial {
  const material = applyWorldLighting(
    applyCloudShadow(
      new THREE.MeshStandardMaterial({
        roughness: 0.95,
        metalness: 0,
        side: THREE.DoubleSide,
        depthWrite: true,
      }),
    ),
    // Nothing is baked into a bush: a wood's own shade is the ground's, and the bush
    // stands in it by being in the same place as the ground.
    { shade: '0.0' },
  );
  const previousPatch = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previousPatch.call(material, shader, renderer);
    Object.assign(shader.uniforms, bushUniforms, {
      uBushSinkFrom: { value: BUSH_SINK_FROM_M },
      uBushSinkTo: { value: BUSH_SINK_TO_M },
    });
    // The season goes in last: `injectSeason` consumes the `#include <common>` line the
    // other two patches hang their declarations off.
    injectSeason(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PRELUDE}`)
      .replace('#include <begin_vertex>', VERTEX_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PRELUDE}`)
      .replace('#include <color_fragment>', FRAGMENT_BODY);
  };
  const key = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${key.call(material)}:bush-v1`;
  material.userData.bush = true;
  return material;
}
