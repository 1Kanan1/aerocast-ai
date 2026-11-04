-- Initial schema. Observations are append-only and keyed on their own time,
-- so re-ingesting a cache file is idempotent.

create table if not exists stations (
    icao text primary key,
    name text not null,
    state text,
    country text,
    lat double precision not null,
    lon double precision not null,
    elev_m integer,
    site_type text
);

create table if not exists metar_observations (
    station_icao text not null references stations (icao),
    obs_time timestamptz not null,
    report_time timestamptz,
    raw text not null,
    decoded jsonb not null,
    category text,
    upstream_category text,
    parse_status text not null,
    parser_version text not null,
    fetched_at timestamptz not null,
    primary key (station_icao, obs_time)
);

create index if not exists metar_observations_obs_time_idx
    on metar_observations (obs_time desc);

create table if not exists taf_forecasts (
    station_icao text not null references stations (icao),
    issue_time timestamptz not null,
    valid_from timestamptz not null,
    valid_to timestamptz not null,
    raw text not null,
    periods jsonb not null,
    parser_version text not null,
    fetched_at timestamptz not null,
    primary key (station_icao, issue_time)
);

create table if not exists ingest_runs (
    id bigserial primary key,
    job text not null,
    started_at timestamptz not null,
    finished_at timestamptz,
    status text not null,
    rows_upserted integer not null default 0,
    error text
);

create index if not exists ingest_runs_job_idx
    on ingest_runs (job, started_at desc);
