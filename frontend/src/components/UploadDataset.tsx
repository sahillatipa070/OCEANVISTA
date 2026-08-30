import {
  Upload,
  X,
  FileCheck2,
  LoaderCircle,
  Database,
  AlertTriangle
} from 'lucide-react';

import { useState } from 'react';

import { useOceanStore } from '../store/oceanStore';

const API = 'https://oceanvista-backend.onrender.com';
type Kind =
  | 'model'
  | 'argo'
  | 'observation';


export default function UploadDataset() {

  const [open, setOpen] = useState(false);

  const [kind, setKind] =
    useState<Kind>('model');

  const [file, setFile] =
    useState<File | null>(null);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState('');

  const [result, setResult] =
    useState<any>(null);

  const s = useOceanStore();


  const upload = async () => {

    if (!file) return;

    setLoading(true);

    setError('');

    try {

      const fd = new FormData();

      fd.append('file', file);


      const response = await fetch(
        `${API}/api/datasets/upload/${kind}`,
        {
          method: 'POST',
          body: fd
        }
      );


      const data = await response.json();


      if (!response.ok) {

        throw new Error(
          data.detail ||
          'Upload failed'
        );

      }


      setResult(data);


      /*
        Only save dataset to dashboard
        if backend validation passed.
      */

      if (data.validation?.valid) {

        const info = {

          id: data.dataset_id,

          filename: data.filename,

          variables:
            data.metadata?.variables || [],

          source:
            `Validated uploaded ${kind} dataset`,

          metadata:
            data.metadata

        };


        /*
          MODEL DATASET
        */

        if (kind === 'model') {

          s.set(
            'uploadedDataset',
            info
          );

          s.set(
            'modelDataset',
            info
          );

          /*
            Clear previous rendered field.

            OceanScene can load
            the new dataset.
          */

          s.set(
            'modelField',
            null
          );


          /*
            Get times from uploaded
            NetCDF metadata.
          */

          const uploadedTimes =
            Array.isArray(data.metadata?.times)
              ? data.metadata.times
                  .filter(
                    (time: any) =>
                      time !== null &&
                      time !== undefined &&
                      String(time).trim() !== ''
                  )
                  .map(
                    (time: any) =>
                      String(time)
                  )
              : [];


          /*
            Update Zustand store.

            Header.tsx reads these
            values dynamically.
          */

          s.set(
            'dataTimes',
            uploadedTimes
          );


          /*
            Always start with
            the first available time.
          */

          s.set(
            'timeIndex',
            0
          );

        }


        /*
          ARGO DATASET
        */

        if (kind === 'argo') {

          s.set(
            'argoDataset',
            info
          );

          s.set(
            'instrument',
            'Argo Float'
          );

          s.set(
            'selectedProfileIndex',
            0
          );

        }


        /*
          OBSERVATION DATASET
        */

        if (kind === 'observation') {

          s.set(
            'observationDataset',
            info
          );

          s.set(
            'instrument',
            'Argo Float'
          );

          s.set(
            'selectedProfileIndex',
            0
          );

        }

      }

    } catch (e: any) {

      setError(
        `${e.message}. ` +
        `Make sure FastAPI is running on port 8000.`
      );

    } finally {

      setLoading(false);

    }

  };


  return (

    <>

      {/* Upload button */}

      <button
        className="upload-trigger"
        onClick={() => {

          setOpen(true);

          setResult(null);

          setError('');

        }}
      >

        <Upload size={15} />

        Scientific Data Workspace

      </button>


      {/* Dataset status */}

      {s.modelDataset && (

        <div className="upload-status">

          <FileCheck2 size={14} />

          <span>
            Model: {s.modelDataset.filename}
          </span>

        </div>

      )}


      {s.argoDataset && (

        <div className="upload-status">

          <FileCheck2 size={14} />

          <span>
            Argo: {s.argoDataset.filename}
          </span>

        </div>

      )}


      {s.observationDataset && (

        <div className="upload-status">

          <FileCheck2 size={14} />

          <span>
            Obs: {s.observationDataset.filename}
          </span>

        </div>

      )}


      {/* Upload modal */}

      {open && (

        <div className="modalback">

          <div className="modal upload-modal">


            <button
              className="close"
              onClick={() => {

                if (!loading) {

                  setOpen(false);

                }

              }}
            >

              <X />

            </button>


            <h2>

              <Database size={19} />

              Load Scientific Data

            </h2>


            <p>

              Upload real datasets.
              OceanVista validates coordinates,
              dimensions, variables and missing
              values before visualization.

            </p>


            {/* Dataset type tabs */}

            <div className="upload-tabs">

              {(
                [
                  'model',
                  'argo',
                  'observation'
                ] as Kind[]
              ).map((k) => (

                <button

                  key={k}

                  className={
                    kind === k
                      ? 'active'
                      : ''
                  }

                  onClick={() => {

                    setKind(k);

                    setFile(null);

                    setResult(null);

                    setError('');

                  }}

                >

                  {k === 'model'
                    ? '① Model NetCDF'
                    : k === 'argo'
                    ? '② Argo NetCDF'
                    : '③ CSV / ASCII'}

                </button>

              ))}

            </div>


            {/* Instructions */}

            <p className="panel-note">

              {kind === 'model'
                ? 'Required: latitude, longitude, depth, time and numeric scientific variables.'
                : kind === 'argo'
                ? 'Reads real float/profile coordinates, depth, time and available scientific variables.'
                : 'CSV, TXT or ASCII observations with detectable coordinate columns.'}

            </p>


            {/* File input */}

            <input

              type="file"

              accept={
                kind === 'observation'
                  ? '.csv,.txt,.asc,.ascii,.nc,.nc4,.cdf'
                  : '.nc,.nc4,.cdf'
              }

              onChange={(e) => {

                setFile(
                  e.target.files?.[0] || null
                );

                setResult(null);

                setError('');

              }}

            />


            {/* Selected file */}

            {file && (

              <div className="file-name">

                Selected: {file.name}

              </div>

            )}


            {/* Error */}

            {error && (

              <div className="upload-error">

                <AlertTriangle size={15} />

                {error}

              </div>

            )}


            {/* Upload button */}

            {!result ? (

              <button

                className="export"

                disabled={
                  !file ||
                  loading
                }

                onClick={upload}

              >

                {loading ? (

                  <>

                    <LoaderCircle
                      className="spin"
                      size={16}
                    />

                    Validating...

                  </>

                ) : (

                  <>

                    <Upload size={16} />

                    Upload & Validate

                  </>

                )}

              </button>

            ) : (

              <div

                className={
                  result.validation?.valid
                    ? 'validation goodbox'
                    : 'validation badbox'
                }

              >

                <b>

                  {result.validation?.valid
                    ? '✓ DATASET READY'
                    : '⚠ DATASET INVALID'}

                </b>


                <span>

                  {result.filename}

                </span>


                <div className="meta-grid">

                  <span>

                    Variables

                    <b>

                      {
                        result.metadata?.variables
                          ?.length || 0
                      }

                    </b>

                  </span>


                  <span>

                    Dimensions

                    <b>

                      {
                        result.metadata?.dimensions
                          ?.length || 0
                      }

                    </b>

                  </span>

                </div>


                {/* Validation errors */}

                {result.validation?.errors?.map(
                  (message: string) => (

                    <small
                      key={message}
                    >

                      • {message}

                    </small>

                  )
                )}


                {/* Validation warnings */}

                {result.validation?.warnings?.map(
                  (message: string) => (

                    <small
                      key={`warning-${message}`}
                    >

                      ⚠ {message}

                    </small>

                  )
                )}


                <button

                  className="export"

                  onClick={() => {

                    if (
                      result.validation?.valid
                    ) {

                      setOpen(false);

                    } else {

                      setResult(null);

                    }

                  }}

                >

                  {result.validation?.valid
                    ? 'Continue to Dashboard'
                    : 'Choose Another File'}

                </button>

              </div>

            )}

          </div>

        </div>

      )}

    </>

  );

}
