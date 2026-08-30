import { create } from 'zustand';

export type Variable =
  | 'Temperature (°C)'
  | 'Salinity (PSU)'
  | 'Chlorophyll (mg/m³)'
  | 'Ocean Current Speed'
  | 'Dissolved Oxygen';

export type Mode =
  | '3D Volume'
  | 'Depth Slice'
  | 'Isosurface';

export type Layer =
  | 'Numerical Model'
  | 'Argo Floats'
  | 'Gliders'
  | 'Currents'
  | 'Chlorophyll'
  | 'Bathymetry'
  | 'Sea Surface Height';

export type RightTab =
  | 'PROFILE'
  | 'MODEL VS OBSERVATION'
  | 'QUALITY';

export type DatasetInfo = {
  id: string;
  filename: string;
  variables: any[];
  source: string;
  metadata?: any;
};

export type State = {
  region: string;

  variable: Variable;

  depth: number;

  timeIndex: number;

  mode: Mode;

  opacity: number;

  vertical: number;

  colorScale: string;

  colorMin: number;

  colorMax: number;

  log: boolean;

  layers: Record<Layer, boolean>;

  instrument: 'Argo Float' | 'Glider';

  instrumentId: string;

  rightTab: RightTab;

  playing: boolean;

  speed: number;

  uploadedDataset: DatasetInfo | null;

  modelDataset: DatasetInfo | null;

  argoDataset: DatasetInfo | null;

  observationDataset: DatasetInfo | null;

  modelField: any | null;

  /*
    Times extracted dynamically from
    the uploaded model NetCDF dataset.
  */
  dataTimes: string[];

  measureMode: boolean;

  measurePoints: [number, number, number][];

  selectedProfileIndex: number;

  set: <K extends keyof State>(
    key: K,
    value: State[K]
  ) => void;

  toggle: (key: Layer) => void;
};

/*
  Kept only for backward compatibility
  with older components.

  New components should use:
  useOceanStore().dataTimes
*/
export const times: string[] = [];

export const useOceanStore = create<State>((set) => ({
  region: 'Bay of Bengal',

  variable: 'Temperature (°C)',

  depth: 100,

  timeIndex: 0,

  mode: '3D Volume',

  opacity: 0.85,

  vertical: 1.6,

  colorScale: 'Turbo',

  colorMin: 5,

  colorMax: 30,

  log: false,

  layers: {
    'Numerical Model': true,
    'Argo Floats': true,
    'Gliders': true,
    'Currents': true,
    'Chlorophyll': false,
    'Bathymetry': false,
    'Sea Surface Height': false
  },

  instrument: 'Argo Float',

  instrumentId: '2903671',

  rightTab: 'MODEL VS OBSERVATION',

  playing: false,

  speed: 1,

  uploadedDataset: null,

  modelDataset: null,

  argoDataset: null,

  observationDataset: null,

  modelField: null,

  /*
    Initially empty.

    Filled automatically after
    a model NetCDF file is uploaded.
  */
  dataTimes: [],

  measureMode: false,

  measurePoints: [],

  selectedProfileIndex: 0,

  set: (key, value) =>
    set({
      [key]: value
    } as Partial<State>),

  toggle: (key) =>
    set((state) => ({
      layers: {
        ...state.layers,
        [key]: !state.layers[key]
      }
    }))
}));
