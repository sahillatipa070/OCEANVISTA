import {
  Waves,
  Calendar,
  ChevronDown
} from 'lucide-react';

import { useOceanStore } from '../store/oceanStore';


const vars = [

  'Temperature (°C)',

  'Salinity (PSU)',

  'Chlorophyll (mg/m³)',

  'Ocean Current Speed',

  'Dissolved Oxygen'

];


function formatDate(value: string) {

  if (!value) return '';

  try {

    let date: Date;


    /*
      Handle numeric timestamps.

      Example:
      1765140000000
    */

    if (/^\d+$/.test(value)) {

      const timestamp =
        Number(value);


      /*
        Convert seconds to milliseconds
        when required.
      */

      date = new Date(

        timestamp < 100000000000
          ? timestamp * 1000
          : timestamp

      );

    } else {

      date = new Date(value);

    }


    /*
      Invalid date.

      Return original value instead
      of showing "Invalid Date".
    */

    if (
      isNaN(date.getTime())
    ) {

      return value;

    }


    return date.toLocaleString(

      'en-IN',

      {

        day: '2-digit',

        month: 'short',

        year: 'numeric',

        hour: '2-digit',

        minute: '2-digit',

        hour12: false

      }

    );

  } catch {

    return value;

  }

}


export default function Header() {

  const s =
    useOceanStore();


  /*
    IMPORTANT:

    These times come directly from
    the uploaded model dataset.

    No hardcoded dates are used.
  */

  const availableTimes =
    Array.isArray(s.dataTimes)
      ? s.dataTimes
      : [];


  /*
    Keep timeIndex inside
    valid array bounds.
  */

  const safeTimeIndex =

    availableTimes.length > 0

      ? Math.min(

          Math.max(
            s.timeIndex,
            0
          ),

          availableTimes.length - 1

        )

      : 0;


  const selectedTime =

    availableTimes[
      safeTimeIndex
    ] || '';


  return (

    <header className="header">


      {/* Logo */}

      <div className="brand">

        <Waves />

        <div>

          <b>

            OCEANVISTA 3D

          </b>

          <small>

            Ocean Intelligence Platform

          </small>

        </div>

      </div>


      {/* Variable selector */}

      <Select

        label="VARIABLE"

        value={s.variable}

        values={vars}

        onChange={(value) => {

          s.set(
            'variable',
            value as any
          );

        }}

      />


      {/* Dynamic time selector */}

      <Select

        label="TIME"

        value={selectedTime}

        values={availableTimes}

        displayValue={
          selectedTime
            ? formatDate(
                selectedTime
              )
            : ''
        }

        onChange={(value) => {

          const index =
            availableTimes.indexOf(
              value
            );


          if (index >= 0) {

            s.set(
              'timeIndex',
              index
            );

          }

        }}

        icon={
          <Calendar size={15} />
        }

        placeholder={

          availableTimes.length === 0

            ? 'Upload model dataset'

            : 'Select time'

        }

      />


      {/* User */}

      <div className="user">

        <i>

          OS

        </i>


        <div>

          Oceanographer

          <small>

            INCOS

          </small>

        </div>


        <ChevronDown size={15} />

      </div>


    </header>

  );

}


function Select({

  label,

  value,

  values,

  onChange,

  icon,

  displayValue,

  placeholder

}: {

  label: string;

  value: string;

  values: string[];

  onChange: (
    value: string
  ) => void;

  icon?: React.ReactNode;

  displayValue?: string;

  placeholder?: string;

}) {


  const shownValue =

    displayValue ||

    value ||

    placeholder ||

    'Select';


  return (

    <label className="select">


      <small>

        {label}

      </small>


      <span>


        {shownValue}


        {icon}


        <select

          value={value}

          onChange={(e) => {

            onChange(
              e.target.value
            );

          }}

        >


          {/* Empty state */}

          {values.length === 0 && (

            <option value="">

              {placeholder ||
                'No data available'}

            </option>

          )}


          {/* Dynamic dataset times */}

          {values.map(
            (item, index) => (

              <option

                key={`${item}-${index}`}

                value={item}

              >

                {label === 'TIME'
                  ? formatDate(item)
                  : item}

              </option>

            )
          )}


        </select>


      </span>


    </label>

  );

}
