import { Download, LoaderCircle, Database } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';

import { useOceanStore, type RightTab } from '../store/oceanStore';
import { metrics } from '../utils/metrics';
import { exportCSV } from '../utils/exportReport';
import { useEffect, useState } from 'react';

const API = 'https://oceanvista-backend.onrender.com';

const tabs: RightTab[] = [
  'PROFILE',
  'MODEL VS OBSERVATION',
  'QUALITY'
];

type Real = {
  rows: any[];
  metrics: any;
  instrument: any;
  match?: any;
  source?: string;
} | null;

export default function RightPanel() {
  const s = useOceanStore();

  const obsDataset =
    s.argoDataset || s.observationDataset;

  const [plist, setPlist] = useState<any[]>([]);
  const [real, setReal] = useState<Real>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  /*
    LOAD PROFILES FROM THE UPLOADED DATASET
  */
  useEffect(() => {
    if (!obsDataset) {
      setPlist([]);
      setReal(null);
      return;
    }

    setErr('');

    fetch(
      `${API}/api/datasets/${obsDataset.id}/profiles?variable=${encodeURIComponent(
        s.variable
      )}`
    )
      .then(async r => {
        const data = await r.json();

        if (!r.ok) {
          throw new Error(
            data.detail || 'Could not load profiles'
          );
        }

        return data;
      })
      .then(data => {
        const loadedProfiles =
          Array.isArray(data.profiles)
            ? data.profiles
            : [];

        setPlist(loadedProfiles);

        if (loadedProfiles.length > 0) {
          const safeIndex = Math.min(
            s.selectedProfileIndex,
            loadedProfiles.length - 1
          );

          const selected =
            loadedProfiles[safeIndex];

          if (
            safeIndex !==
            s.selectedProfileIndex
          ) {
            s.set(
              'selectedProfileIndex',
              safeIndex
            );
          }

          if (selected?.id) {
            s.set(
              'instrumentId',
              String(selected.id)
            );
          }
        }
      })
      .catch(error => {
        setPlist([]);
        setErr(error.message);
      });
  }, [
    obsDataset?.id,
    s.variable
  ]);


  /*
    LOAD REAL MODEL VS OBSERVATION DATA
  */
  useEffect(() => {
    if (
      !s.modelDataset ||
      !obsDataset ||
      s.instrument !== 'Argo Float'
    ) {
      setReal(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setErr('');

    fetch(
      `${API}/api/validation/profile?model_id=${encodeURIComponent(
        s.modelDataset.id
      )}&argo_id=${encodeURIComponent(
        obsDataset.id
      )}&profile_index=${s.selectedProfileIndex}&variable=${encodeURIComponent(
        s.variable
      )}`
    )
      .then(async r => {
        const data = await r.json();

        if (!r.ok) {
          throw new Error(
            data.detail || 'Validation failed'
          );
        }

        return data;
      })
      .then(data => {
        setReal(data);
      })
      .catch(error => {
        setReal(null);
        setErr(error.message);
      })
      .finally(() => {
        setLoading(false);
      });

  }, [
    s.modelDataset?.id,
    obsDataset?.id,
    s.selectedProfileIndex,
    s.variable,
    s.instrument
  ]);


  /*
    CURRENT SELECTED UPLOADED PROFILE
  */
  const selectedProfile =
    plist[s.selectedProfileIndex] || null;


  /*
    REAL DATA ONLY

    NO HARDCODED 2903671 DATA
    NO MOCK INSTRUMENT FALLBACK
  */
  const info =
    real?.instrument ||
    selectedProfile ||
    {};


  const rows =
    Array.isArray(real?.rows)
      ? real.rows
      : [];


  const emptyMetrics = {
    bias: 0,
    mae: 0,
    rmse: 0,
    correlation: 0
  };


  const m =
    real?.metrics ||
    (
      rows.length > 0
        ? metrics(rows)
        : emptyMetrics
    );


  const exportNow = () => {
    if (rows.length === 0) {
      return;
    }

    exportCSV(
      String(
        info.id ||
        info.instrument_id ||
        s.instrumentId ||
        'profile'
      ),
      rows,
      m
    );
  };


  const selectedInstrumentId =
    info.id ||
    info.instrument_id ||
    info.platform_number ||
    s.instrumentId ||
    'No profile selected';


  const latitude =
    info.latitude ??
    info.lat ??
    null;


  const longitude =
    info.longitude ??
    info.lon ??
    null;


  const profileTime =
    info.time ??
    info.date ??
    info.datetime ??
    null;


  const maxDepth =
    info.max_depth ??
    info.maxDepth ??
    getMaxDepth(rows);


  return (
    <aside className="right panel">

      {/* =========================
          SELECTED INSTRUMENT
      ========================= */}

      <section className="section instrument">

        <h3>SELECTED INSTRUMENT</h3>


        <div className="tabs">

          <button
            className={
              s.instrument === 'Argo Float'
                ? 'active'
                : ''
            }
            onClick={() =>
              s.set(
                'instrument',
                'Argo Float'
              )
            }
          >
            Argo Float
          </button>


          <button
            className={
              s.instrument === 'Glider'
                ? 'active'
                : ''
            }
            onClick={() => {
              s.set(
                'instrument',
                'Glider'
              );

              setReal(null);
            }}
          >
            Glider
          </button>

        </div>


        {/* UPLOADED PROFILE SELECTOR */}

        {obsDataset &&
          s.instrument === 'Argo Float' &&
          plist.length > 0 && (

          <div className="real-select">

            <Database size={14} />

            <select
              value={s.selectedProfileIndex}
              onChange={e => {
                const index =
                  Number(e.target.value);

                s.set(
                  'selectedProfileIndex',
                  index
                );

                const profile =
                  plist[index];

                if (profile?.id) {
                  s.set(
                    'instrumentId',
                    String(profile.id)
                  );
                }
              }}
            >

              {plist.map(
                (profile, index) => (

                  <option
                    key={`${profile.id}-${index}`}
                    value={index}
                  >

                    {profile.id ||
                      profile.instrument_id ||
                      `Profile ${index + 1}`}

                    {profile.latitude !== undefined &&
                      profile.longitude !== undefined && (
                      <>
                        {' — '}
                        {Number(
                          profile.latitude
                        ).toFixed(2)}
                        ,
                        {Number(
                          profile.longitude
                        ).toFixed(2)}
                      </>
                    )}

                  </option>

                )
              )}

            </select>

          </div>

        )}


        {/* CURRENT INSTRUMENT */}

        <div className="insthead">

          <span>

            ● {info.type ||
              s.instrument ||
              'Instrument'}{' '}

            <b>
              {selectedInstrumentId}
            </b>

          </span>


          <i>
            ● {obsDataset
              ? 'Loaded'
              : 'No Data'}
          </i>

        </div>


        {/* DYNAMIC DATA */}

        <dl>

          <dt>Latitude</dt>

          <dd>
            {latitude !== null &&
            latitude !== undefined
              ? `${Number(latitude).toFixed(2)}°`
              : 'Not available'}
          </dd>


          <dt>Longitude</dt>

          <dd>
            {longitude !== null &&
            longitude !== undefined
              ? `${Number(longitude).toFixed(2)}°`
              : 'Not available'}
          </dd>


          <dt>Date & Time</dt>

          <dd>
            {formatDate(profileTime)}
          </dd>


          <dt>Max Depth</dt>

          <dd>
            {maxDepth > 0
              ? `${Number(maxDepth).toFixed(0)} m`
              : 'Not available'}
          </dd>


          <dt>Variables</dt>

          <dd>

            {real
              ? 'Uploaded dataset'
              : obsDataset
              ? 'Uploaded dataset'
              : 'No dataset'}

          </dd>


          <dt>Quality Flag</dt>

          <dd className="good">

            {real
              ? 'Calculated'
              : obsDataset
              ? 'Loaded'
              : 'Not available'}

          </dd>

        </dl>


        {/* LOADING */}

        {loading && (

          <div className="real-status">

            <LoaderCircle
              className="spin"
              size={15}
            />

            Processing uploaded datasets…

          </div>

        )}


        {/* ERROR */}

        {err && (

          <div className="upload-error">

            {err}

          </div>

        )}

      </section>


      {/* =========================
          CHART SECTION
      ========================= */}

      <section className="section chartsec">

        <div className="tabs tri">

          {tabs.map(tab => (

            <button
              key={tab}
              className={
                s.rightTab === tab
                  ? 'active'
                  : ''
              }
              onClick={() =>
                s.set(
                  'rightTab',
                  tab
                )
              }
            >

              {tab}

            </button>

          ))}

        </div>


        {s.rightTab === 'PROFILE' && (

          <Profile
            rows={rows}
            real={!!real}
            uploaded={!!obsDataset}
          />

        )}


        {s.rightTab ===
          'MODEL VS OBSERVATION' && (

          <Comparison
            rows={rows}
            variable={s.variable}
            m={m}
          />

        )}


        {s.rightTab === 'QUALITY' && (

          <Quality
            rows={rows}
            m={m}
            real={!!real}
          />

        )}


        <button
          className="export"
          onClick={exportNow}
          disabled={rows.length === 0}
        >

          <Download size={15} />

          Export Report

        </button>

      </section>

    </aside>
  );
}


/* =========================
   SCIENTIFIC CHART
========================= */

function ScientificChart({
  rows,
  showModel,
  showObserved
}: {
  rows: any[];
  showModel: boolean;
  showObserved: boolean;
}) {

  if (!rows || rows.length === 0) {
    return (
      <div className="chart">
        <div className="panel-note">
          No validation data available.
        </div>
      </div>
    );
  }

  return (

    <div className="chart">

      <ResponsiveContainer>

        <LineChart
          data={rows}
          margin={{
            top: 10,
            right: 10,
            bottom: 5,
            left: 0
          }}
        >

          <XAxis
            type="number"
            dataKey="observed"
            domain={['auto', 'auto']}
            tick={{
              fill: '#94a3b8',
              fontSize: 10
            }}
          />


          <YAxis
            dataKey="depth"
            type="number"
            reversed
            domain={['auto', 'auto']}
            tick={{
              fill: '#94a3b8',
              fontSize: 10
            }}
          />


          <Tooltip />

          <Legend />


          {showModel && (

            <Line
              name="Model"
              dataKey="model"
              stroke="#f6b73c"
              strokeWidth={2}
              dot={false}
            />

          )}


          {showObserved && (

            <Line
              name="Observed"
              dataKey="observed"
              stroke="#38bdf8"
              strokeWidth={2}
              dot={{
                r: 2
              }}
            />

          )}

        </LineChart>

      </ResponsiveContainer>

    </div>

  );
}


/* =========================
   PROFILE
========================= */

function Profile({
  rows,
  real,
  uploaded
}: {
  rows: any[];
  real: boolean;
  uploaded: boolean;
}) {

  return (

    <>

      <h2>
        {real
          ? 'Observed Profile'
          : 'Profile'}
      </h2>


      <ScientificChart
        rows={rows}
        showModel={false}
        showObserved={true}
      />


      <p className="panel-note">

        {uploaded
          ? 'Profile information from the uploaded dataset.'
          : 'Upload a dataset to view profile information.'}

      </p>


      <DataTable
        rows={rows}
      />

    </>

  );
}


/* =========================
   MODEL VS OBSERVATION
========================= */

function Comparison({
  rows,
  variable,
  m
}: {
  rows: any[];
  variable: string;
  m: any;
}) {

  return (

    <>

      <h2>
        {variable}
      </h2>


      <ScientificChart
        rows={rows}
        showModel
        showObserved
      />


      <DataTable
        rows={rows}
      />


      {rows.length > 0 && (

        <>

          <h2>
            Validation Metrics
          </h2>


          <div className="metrics">

            <Metric
              n="Bias"
              v={Number(
                m.bias
              ).toFixed(2)}
            />


            <Metric
              n="MAE"
              v={Number(
                m.mae
              ).toFixed(2)}
            />


            <Metric
              n="RMSE"
              v={Number(
                m.rmse
              ).toFixed(2)}
            />


            <Metric
              n="Correlation"
              v={Number(
                m.correlation
              ).toFixed(2)}
            />

          </div>

        </>

      )}

    </>

  );
}


/* =========================
   QUALITY
========================= */

function Quality({
  rows,
  m,
  real
}: {
  rows: any[];
  m: any;
  real: boolean;
}) {

  if (!rows || rows.length === 0) {

    return (

      <>

        <h2>
          Quality Assessment
        </h2>

        <div className="panel-note">
          Validation results will appear after
          model and observation data are processed.
        </div>

      </>

    );
  }


  const maxDiff =
    Math.max(
      ...rows.map(row =>
        Math.abs(
          Number(row.model || 0) -
          Number(row.observed || 0)
        )
      )
    );


  return (

    <>

      <h2>
        Quality Assessment
      </h2>


      <div className="quality-summary">

        <b className="good">

          {real
            ? 'Calculated'
            : 'Available'}

        </b>


        <span>
          Dataset validation results
        </span>

      </div>


      <div className="quality-grid">

        <div>

          <small>
            Samples
          </small>

          <b>
            {rows.length}
          </b>

        </div>


        <div>

          <small>
            Max Difference
          </small>

          <b>
            {maxDiff.toFixed(2)}
          </b>

        </div>


        <div>

          <small>
            RMSE
          </small>

          <b>
            {Number(
              m.rmse
            ).toFixed(2)}
          </b>

        </div>


        <div>

          <small>
            Correlation
          </small>

          <b>
            {Number(
              m.correlation
            ).toFixed(2)}
          </b>

        </div>

      </div>


      <DataTable
        rows={rows}
      />

    </>

  );
}


/* =========================
   DATA TABLE
========================= */

function DataTable({
  rows
}: {
  rows: any[];
}) {

  if (!rows || rows.length === 0) {

    return (

      <div className="panel-note">
        No data available.
      </div>

    );
  }


  return (

    <table>

      <thead>

        <tr>

          <th>
            Depth (m)
          </th>

          <th>
            Observed
          </th>

          <th>
            Model
          </th>

          <th>
            Diff
          </th>

        </tr>

      </thead>


      <tbody>

        {rows.map(
          (row, index) => (

            <tr
              key={`${row.depth}-${index}`}
            >

              <td>
                {Number(
                  row.depth ?? 0
                ).toFixed(0)}
              </td>


              <td>
                {Number(
                  row.observed ?? 0
                ).toFixed(2)}
              </td>


              <td>
                {Number(
                  row.model ?? 0
                ).toFixed(2)}
              </td>


              <td>
                {(
                  Number(
                    row.model ?? 0
                  ) -
                  Number(
                    row.observed ?? 0
                  )
                ).toFixed(2)}
              </td>

            </tr>

          )
        )}

      </tbody>

    </table>

  );
}


/* =========================
   METRIC
========================= */

function Metric({
  n,
  v
}: {
  n: string;
  v: string;
}) {

  return (

    <div>

      <small>
        {n}
      </small>

      <b>
        {v}
      </b>

    </div>

  );

}


/* =========================
   GET MAXIMUM DEPTH
========================= */

function getMaxDepth(
  rows: any[]
) {

  if (
    !rows ||
    rows.length === 0
  ) {
    return 0;
  }


  const depths =
    rows
      .map(row =>
        Number(
          row.depth ?? 0
        )
      )
      .filter(value =>
        Number.isFinite(value)
      );


  if (depths.length === 0) {
    return 0;
  }


  return Math.max(
    ...depths
  );

}


/* =========================
   FORMAT DATE
========================= */

function formatDate(
  value: any
) {

  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return 'Not available';
  }


  /*
    HANDLE NUMERIC TIMESTAMPS

    Example:
    1786514400000000000

    This is typically nanoseconds.
  */

  if (
    typeof value === 'number' ||
    (
      typeof value === 'string' &&
      /^\d+$/.test(value)
    )
  ) {

    let timestamp =
      Number(value);


    // Nanoseconds
    if (
      timestamp > 1e16
    ) {
      timestamp =
        timestamp / 1000000;
    }


    // Microseconds
    else if (
      timestamp > 1e13
    ) {
      timestamp =
        timestamp / 1000;
    }


    // Unix seconds
    else if (
      timestamp < 1e11
    ) {
      timestamp =
        timestamp * 1000;
    }


    const date =
      new Date(timestamp);


    if (
      !Number.isNaN(
        date.getTime()
      )
    ) {

      return date.toLocaleString();

    }

  }


  /*
    NORMAL DATE STRING
  */

  const date =
    new Date(value);


  if (
    !Number.isNaN(
      date.getTime()
    )
  ) {

    return date.toLocaleString();

  }


  return String(value);

}
