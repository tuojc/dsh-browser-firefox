import { copyManifest, outDir, targetBuild } from './vite.shared.ts'

/** Background script: IIFE (Firefox loads classic background scripts; no "type": "module"). */
export default targetBuild('src/background/index.ts', 'iife', 'background.js', true)

export { copyManifest, outDir }
