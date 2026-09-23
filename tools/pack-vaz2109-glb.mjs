#!/usr/bin/env node
/** Meshopt-pack the approved DFF scene without quantizing its POSITION stream.
 *
 * The usual `gltf-transform optimize --compress meshopt` quantizes positions;
 * the factory-fitted body has already been approved. The FILTER encoder keeps
 * POSITION as float32 while still compressing buffer views. Wheel rim/tyre
 * materials were split by the donor FBX's authored UV palette in stage 35:
 * never apply the pack-wide radial rim-split heuristic to them again.
 *
 * Candidate only: release/publication and runtime integration require later gates.
 */
import { createHash } from 'node:crypto';
import { readFile, rename, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const root = resolve(import.meta.dirname, '../build/vehicles/vaz2109_admiral');
const source = `${root}/50-assembled/vaz2109-assembled.glb`;
const destination = `${root}/60-release/vaz2109-candidate.glb`;
const staging = `${root}/60-release/vaz2109-staging.glb`;
const expected = JSON.parse(await readFile(`${root}/50-assembled/report.json`, 'utf8')).outputSha256;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const input = await readFile(source);
if (digest(input) !== expected) throw new Error('Approved lamp assembly hash changed');
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder,
});
const document = await io.read(source);
const scene = document.getRoot();
if (scene.listTextures().length) throw new Error('Texture-free contract violated');
for (const name of ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']) {
  const wheel = scene.listNodes().find((node) => node.getName() === name);
  if (!wheel?.getMesh()) throw new Error(`Missing assembled wheel ${name}`);
  const materials = new Set(wheel.getMesh().listPrimitives().map((p) => p.getMaterial()?.getName()));
  if (!materials.has('Tyres') || !materials.has('wheel_rim')) {
    throw new Error(`${name}: donor UV rim/tyre split was lost`);
  }
}
const extension = document.createExtension(EXTMeshoptCompression).setRequired(true);
extension.setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
// FILTER retains float POSITION, but encodes NORMAL in normalized bytes; glTF
// requires KHR_mesh_quantization to declare that accessor format.
document.createExtension(KHRMeshQuantization).setRequired(true);
await mkdir(resolve(root, '60-release'), {recursive: true});
await io.write(staging, document);
const output = await readFile(staging);
const decoded = await io.read(staging);
for (const name of ['headlights','taillights','brake_lights','reverse_lights',
                    'front_blinker_left','front_blinker_right',
                    'side_blinker_left','side_blinker_right',
                    'rear_blinker_left','rear_blinker_right']) {
  if (!decoded.getRoot().listNodes().some((node) => node.getName() === name && node.getMesh())) {
    throw new Error(`Packed candidate lost lamp node ${name}`);
  }
}
await rename(staging, destination);
await writeFile(`${root}/60-release/report.json`, JSON.stringify({
  inputSha256: expected, outputSha256: digest(output),
  sourceBytes: input.length, resultBytes: output.length,
  compression: 'EXT_meshopt_compression FILTER (POSITION stays float32; no second simplification)',
  radialRimSplit: false,
}, null, 2) + '\n');
console.log(`${destination}: ${input.length} -> ${output.length} bytes, sha256 ${digest(output)}`);
