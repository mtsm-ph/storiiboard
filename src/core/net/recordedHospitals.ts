import { nominatimHospitals, type FoundHospital } from './hospitals';
import cusco from './recorded/nominatim-hospitals-cusco.json';

// Development builds only (loaded behind import.meta.env.DEV, so a release never carries it): the nearest-hospital
// search in a browser, where there's no Rust side to ask, answers from a hand-written Nominatim answer in its jsonv2
// shape. The end-to-end tests search through it, so no test ever asks the real service. Every place finds the same
// hospitals (the answer is ranked by distance from the place after, as with the real one).

export function recordedHospitals(): Promise<FoundHospital[]> {
  return Promise.resolve(nominatimHospitals(cusco));
}
