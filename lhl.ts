/**
 * Utilities for measuring the syncopation in polyphonic rhythms,
 * as represented by NoteSequence objects.
 *
 * Implements the method described in:
 *     Maria A. G. Witek, Eric F. Clarke, Mikkel Wallentin, Morten L. Kringelbach, and Peter Vuust.
 *     Syncopation, Body-Movement and Pleasure in Groove Music. PLOS ONE, 9(4):e94446, apr 2014
 *     10.1371/journal.pone.0094446
 *
 * Author: Thomas Kaplan
 *
 */

import {NoteSequence} from '../src/index';

// Metric weights (16th-note grid), lower values are less metrically salient
const WEIGHTS16: number[] = [
   0, -4, -3, -4,
  -2, -4, -3, -4,
  -1, -4, -3, -4,
  -2, -4, -3, -4,
];
export const WEIGHTS32: number[] = WEIGHTS16.concat(WEIGHTS16);

// Instrument weights, higher values are more salient
interface InstWeights {
  [key: string]: number;
}
export const INSTWEIGHTS:InstWeights = {
  "BD_HH-SD":    2, // bass on N followed by snare+hihat on Ndi, N metrically weaker or equal to Ndi
  "BD-HH_HH-SD": 2, // ""
  "SD_BD-HH":    1, // snare on N followed by bass+hihat on Ndi, N metrically weaker or equal to Ndi
  "HH-SD_BD-HH": 1, // ""
  "SD_HH":       5, // hihat on pulse, and snare on syncopated note
  "BD_HH":       5, // hihat on pulse, and bass on syncopated note
};
// Map from MIDI pitch to drum
interface MidiMap {
  [key: number]: string;
}
export const MIDIMAP:MidiMap = {35: "BD", 36: "BD", 37: "SD", 38: "SD", 42: "HH"};

// Syncopation index for polyphonic rhythm
// Witek et al. (2014): 10.1371/journal.pone.0094446
function polylhlsyncopation(rhythm: string[], weights: number[],
                            iweights: InstWeights): number {
  let score: number = 0;
  for (let i: number = 0; i < rhythm.length; i++) {
    // Event here? If so, check syncopation score.
    if (rhythm[i] !== "") {
      let prev: number = i;
      do {
        prev = prev - 1;
        // Wrap backwards in rhythm to find prev event.
        if (prev < 0) {
          prev = rhythm.length + prev;
        }
      } while (rhythm[prev] === "")

      // If prev event is weighted lower (weaker), tally syncopation.
      let syncopation: number = weights[i] - weights[prev];
      if (syncopation > 0) {
        // Create instrument string, e.g. 'BD_SN', 'BD_SN-HH'
        const instStr: string = rhythm[prev] + "_" + rhythm[i];
        let instScore: number = 0;
        // Lookup associated weight for this instrumental syncopation.
        if (instStr in iweights) {
          instScore = iweights[instStr];
        }
        // Add syncopation score and instrument weight
        score += (syncopation + instScore);
      }
    }
  }
  return score;
}

// Convert NoteSequence rhythm into a grid-based representation of instrument strings,
//  e.g. ["BD-HH", "HH", "HH-SN", "HH", ...]
function chunkstorhythm(chunks: NoteSequence,
                        length: number, step: number,
                        midimap: MidiMap): string[] {

  // Create our empty metrical grid
  let rhythm: number[][] = [];
  for (let i: number = 0; i < length; i++) {
    rhythm.push([]);
  }

  // Fill grid with pitch events in MIDI
  for (let i: number = 0; i < chunks.notes.length; i++) {
    const pitch: number = chunks.notes[i].pitch;
    const j: number = chunks.notes[i].quantizedStartStep;
    if (j >= rhythm.length) {
      // TODO: Investigate where this evil comes from in magenta-js
      console.log("Bad quantised step - ignoring", j, rhythm.length);
    } else {
      rhythm[j].push(pitch);
    }
  }

  // Re-shape the list of pitch lists -> list of sorted inst strings
  let rhythmStr: string[] = [];
  for (const pitches of rhythm) {
    if (pitches.length === 0) {
      rhythmStr.push("");
    } else {
      // Map pitches to MIDI instruments and connect with hyphens
      // [42,35] -> "BD-HH"
      let insts: string[] = [];
      for (const inst of pitches) {
        insts.push(midimap[inst]);
      }
      insts.sort();
      rhythmStr.push(insts.join("-"));
    }
  }
  return rhythmStr;
}

// Syncopation index for polyphonic rhythm (NoteSequence)
export function chunkslhlsyncopation(chunks: NoteSequence, midimap: MidiMap,
                                     weights: number[], iweights: InstWeights,
                                     step: number): number {
  const rhythm: string[] = chunkstorhythm(chunks, weights.length, step, midimap);
  return polylhlsyncopation(rhythm, weights, iweights);
}

