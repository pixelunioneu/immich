--
-- PostgreSQL database dump
--


-- Dumped from database version 14.19 (Debian 14.19-1.pgdg12+1)
-- Dumped by pg_dump version 14.19 (Debian 14.19-1.pgdg12+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: cube; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS cube WITH SCHEMA public;


--
-- Name: EXTENSION cube; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION cube IS 'data type for multidimensional cubes';


--
-- Name: earthdistance; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS earthdistance WITH SCHEMA public;


--
-- Name: EXTENSION earthdistance; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION earthdistance IS 'calculate great-circle distances on the surface of the Earth';


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: unaccent; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;


--
-- Name: EXTENSION unaccent; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION unaccent IS 'text search dictionary that removes accents';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


--
-- Name: vchord; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vchord WITH SCHEMA public;


--
-- Name: EXTENSION vchord; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION vchord IS 'vchord: Vector database plugin for Postgres, written in Rust, specifically designed for LLM';


--
-- Name: album_user_role_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.album_user_role_enum AS ENUM (
    'owner',
    'editor',
    'viewer'
);


--
-- Name: asset_checksum_algorithm_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.asset_checksum_algorithm_enum AS ENUM (
    'sha1',
    'sha1-path'
);


--
-- Name: asset_visibility_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.asset_visibility_enum AS ENUM (
    'archive',
    'timeline',
    'hidden',
    'locked'
);


--
-- Name: assets_status_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.assets_status_enum AS ENUM (
    'active',
    'trashed',
    'deleted'
);


--
-- Name: person_user_role_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.person_user_role_enum AS ENUM (
    'read',
    'write',
    'admin'
);


--
-- Name: sourcetype; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.sourcetype AS ENUM (
    'machine-learning',
    'exif',
    'manual'
);


--
-- Name: video_stream_variant_codec_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.video_stream_variant_codec_enum AS ENUM (
    'av1',
    'hevc',
    'h264'
);


--
-- Name: album_asset_delete_audit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.album_asset_delete_audit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      INSERT INTO album_asset_audit ("albumId", "assetId")
      SELECT "albumId", "assetId" FROM OLD
      WHERE "albumId" IN (SELECT "id" FROM album WHERE "id" IN (SELECT "albumId" FROM OLD));
      RETURN NULL;
    END
  $$;


--
-- Name: album_user_after_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.album_user_after_insert() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      UPDATE album SET "updatedAt" = clock_timestamp(), "updateId" = immich_uuid_v7(clock_timestamp())
      WHERE "id" IN (SELECT "albumId" FROM inserted_rows)
        AND NOT EXISTS (SELECT FROM inserted_rows WHERE role = 'owner');
      RETURN NULL;
    END
  $$;


--
-- Name: album_user_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.album_user_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      DELETE FROM "album"
      WHERE "album"."id" = OLD."albumId"
      AND NOT EXISTS (SELECT "albumId" FROM "album_user" WHERE "album_user"."albumId" = "album"."id" AND "album_user"."role" = 'owner');

      RETURN NULL;
    END
  $$;


--
-- Name: album_user_delete_audit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.album_user_delete_audit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      INSERT INTO album_audit ("albumId", "userId")
      SELECT "albumId", "userId"
      FROM OLD;

      IF pg_trigger_depth() = 1 THEN
        INSERT INTO album_user_audit ("albumId", "userId")
        SELECT "albumId", "userId"
        FROM OLD;
      END IF;

      RETURN NULL;
    END
  $$;


--
-- Name: asset_delete_audit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.asset_delete_audit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      INSERT INTO asset_audit ("assetId", "ownerId")
      SELECT "id", "ownerId"
      FROM OLD;
      RETURN NULL;
    END
  $$;


--
-- Name: asset_edit_audit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.asset_edit_audit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      INSERT INTO asset_edit_audit ("editId", "assetId")
      SELECT "id", "assetId"
      FROM OLD;
      RETURN NULL;
    END
  $$;


--
-- Name: asset_edit_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.asset_edit_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      UPDATE asset
      SET "isEdited" = false
      FROM deleted_edit
      WHERE asset.id = deleted_edit."assetId" AND asset."isEdited"
        AND NOT EXISTS (SELECT FROM asset_edit edit WHERE edit."assetId" = asset.id);
      RETURN NULL;
    END
  $$;


--
-- Name: asset_edit_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.asset_edit_insert() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      UPDATE asset
      SET "isEdited" = true
      FROM inserted_edit
      WHERE asset.id = inserted_edit."assetId" AND NOT asset."isEdited";
      RETURN NULL;
    END
  $$;


--
-- Name: asset_face_audit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.asset_face_audit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      INSERT INTO asset_face_audit ("assetFaceId", "assetId")
      SELECT "id", "assetId"
      FROM OLD;
      RETURN NULL;
    END
  $$;


--
-- Name: asset_face_set_asset_state(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.asset_face_set_asset_state() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      -- FOR SHARE so a concurrent update of the asset cannot leave this face with stale state
      SELECT "ownerId", "visibility", "deletedAt"
      INTO NEW."ownerId", NEW."assetVisibility", NEW."assetDeletedAt"
      FROM asset
      WHERE "id" = NEW."assetId"
      FOR SHARE;
      RETURN NEW;
    END
  $$;


--
-- Name: asset_face_update_asset_state(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.asset_face_update_asset_state() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      UPDATE asset_face
      SET "ownerId" = NEW."ownerId", "assetVisibility" = NEW."visibility", "assetDeletedAt" = NEW."deletedAt"
      WHERE "assetId" = NEW."id";
      RETURN NULL;
    END
  $$;


--
-- Name: asset_metadata_audit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.asset_metadata_audit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      INSERT INTO asset_metadata_audit ("assetId", "key")
      SELECT "assetId", "key"
      FROM OLD;
      RETURN NULL;
    END
  $$;


--
-- Name: asset_ocr_delete_audit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.asset_ocr_delete_audit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      INSERT INTO asset_ocr_audit ("assetId")
      SELECT "assetId"
      FROM OLD;
      RETURN NULL;
    END
  $$;


--
-- Name: f_concat_ws(text, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.f_concat_ws(text, text[]) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $_$SELECT array_to_string($2, $1)$_$;


--
-- Name: f_unaccent(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.f_unaccent(text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    RETURN public.unaccent('public.unaccent'::regdictionary, $1);


--
-- Name: immich_uuid_v7(timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.immich_uuid_v7(p_timestamp timestamp with time zone DEFAULT clock_timestamp()) RETURNS uuid
    LANGUAGE sql
    AS $$
    select encode(
      set_bit(
        set_bit(
          overlay(uuid_send(gen_random_uuid())
                  placing substring(int8send(floor(extract(epoch from p_timestamp) * 1000)::bigint) from 3)
                  from 1 for 6
          ),
          52, 1
        ),
        53, 1
      ),
      'hex')::uuid;
  $$;


--
-- Name: ll_to_earth_public(double precision, double precision); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ll_to_earth_public(latitude double precision, longitude double precision) RETURNS public.earth
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    AS $$
    SELECT public.cube(public.cube(public.cube(public.earth()*cos(radians(latitude))*cos(radians(longitude))),public.earth()*cos(radians(latitude))*sin(radians(longitude))),public.earth()*sin(radians(latitude)))::public.earth
  $$;


--
-- Name: memory_asset_delete_audit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.memory_asset_delete_audit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      INSERT INTO memory_asset_audit ("memoryId", "assetId")
      SELECT "memoriesId", "assetId" FROM OLD
      WHERE "memoriesId" IN (SELECT "id" FROM memory WHERE "id" IN (SELECT "memoriesId" FROM OLD));
      RETURN NULL;
    END
  $$;


--
-- Name: memory_delete_audit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.memory_delete_audit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      INSERT INTO memory_audit ("memoryId", "userId")
      SELECT "id", "ownerId"
      FROM OLD;
      RETURN NULL;
    END
  $$;


--
-- Name: partner_delete_audit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.partner_delete_audit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      INSERT INTO partner_audit ("sharedById", "sharedWithId")
      SELECT "sharedById", "sharedWithId"
      FROM OLD;
      RETURN NULL;
    END
  $$;


--
-- Name: person_delete_audit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.person_delete_audit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      INSERT INTO person_audit ("personGroupId", "ownerId")
      SELECT "personGroupId", "ownerId"
      FROM OLD;
      RETURN NULL;
    END
  $$;


--
-- Name: person_delete_shares(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.person_delete_shares() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      DELETE FROM person_user
      USING deleted_rows
      WHERE person_user."personGroupId" = deleted_rows."personGroupId"
        AND person_user."sharedWithId" = deleted_rows."ownerId";
      RETURN NULL;
    END
  $$;


--
-- Name: person_group_delete_audit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.person_group_delete_audit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      INSERT INTO person_group_audit ("personGroupId", "clusterGroupId")
      SELECT "id", "clusterGroupId"
      FROM OLD;
      RETURN NULL;
    END
  $$;


--
-- Name: person_user_after_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.person_user_after_insert() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      INSERT INTO person ("ownerId", "personGroupId", "name", "birthDate")
      SELECT DISTINCT ON (i."sharedWithId", i."personGroupId")
        i."sharedWithId", i."personGroupId", shared."name", shared."birthDate"
      FROM inserted_rows i
      INNER JOIN person shared
        ON shared."ownerId" = i."sharedById" AND shared."personGroupId" = i."personGroupId"
      ORDER BY i."sharedWithId", i."personGroupId", shared."name" = '', shared."birthDate" IS NULL
      ON CONFLICT ("ownerId", "personGroupId") DO UPDATE
      SET
        "name" = CASE WHEN person."name" = '' THEN EXCLUDED."name" ELSE person."name" END,
        "birthDate" = COALESCE(person."birthDate", EXCLUDED."birthDate")
      WHERE (person."name" = '' AND EXCLUDED."name" <> '')
        OR (person."birthDate" IS NULL AND EXCLUDED."birthDate" IS NOT NULL);
      RETURN NULL;
    END
  $$;


--
-- Name: stack_delete_audit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.stack_delete_audit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      INSERT INTO stack_audit ("stackId", "userId")
      SELECT "id", "ownerId"
      FROM OLD;
      RETURN NULL;
    END
  $$;


--
-- Name: updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
        clock_timestamp TIMESTAMP := clock_timestamp();
    BEGIN
        new."updatedAt" = clock_timestamp;
        new."updateId" = immich_uuid_v7(clock_timestamp);
        return new;
    END;
  $$;


--
-- Name: user_delete_audit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.user_delete_audit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      INSERT INTO user_audit ("userId")
      SELECT "id"
      FROM OLD;
      RETURN NULL;
    END
  $$;


--
-- Name: user_metadata_audit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.user_metadata_audit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      INSERT INTO user_metadata_audit ("userId", "key")
      SELECT "userId", "key"
      FROM OLD;
      RETURN NULL;
    END
  $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: activity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "albumId" uuid NOT NULL,
    "userId" uuid NOT NULL,
    "assetId" uuid,
    comment text,
    "isLiked" boolean DEFAULT false NOT NULL,
    "updateId" uuid DEFAULT public.immich_uuid_v7() NOT NULL,
    CONSTRAINT activity_like_check CHECK ((((comment IS NULL) AND ("isLiked" = true)) OR ((comment IS NOT NULL) AND ("isLiked" = false))))
);


--
-- Name: album; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.album (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "albumName" character varying DEFAULT 'Untitled Album'::character varying NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "albumThumbnailAssetId" uuid,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    description text,
    "deletedAt" timestamp with time zone,
    "isActivityEnabled" boolean DEFAULT true NOT NULL,
    "order" character varying DEFAULT 'desc'::character varying NOT NULL,
    "updateId" uuid DEFAULT public.immich_uuid_v7() NOT NULL
);


--
-- Name: COLUMN album."albumThumbnailAssetId"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.album."albumThumbnailAssetId" IS 'Asset ID to be used as thumbnail';


--
-- Name: album_asset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.album_asset (
    "albumId" uuid NOT NULL,
    "assetId" uuid NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updateId" uuid DEFAULT public.immich_uuid_v7() NOT NULL
);


--
-- Name: album_asset_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.album_asset_audit (
    id uuid DEFAULT public.immich_uuid_v7() NOT NULL,
    "albumId" uuid NOT NULL,
    "assetId" uuid NOT NULL,
    "deletedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: album_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.album_audit (
    id uuid DEFAULT public.immich_uuid_v7() NOT NULL,
    "albumId" uuid NOT NULL,
    "userId" uuid NOT NULL,
    "deletedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: album_user; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.album_user (
    "albumId" uuid NOT NULL,
    "userId" uuid NOT NULL,
    role public.album_user_role_enum DEFAULT 'editor'::public.album_user_role_enum NOT NULL,
    "updateId" uuid DEFAULT public.immich_uuid_v7() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "createId" uuid DEFAULT public.immich_uuid_v7() NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: album_user_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.album_user_audit (
    id uuid DEFAULT public.immich_uuid_v7() NOT NULL,
    "albumId" uuid NOT NULL,
    "userId" uuid NOT NULL,
    "deletedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: api_key; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_key (
    name character varying NOT NULL,
    key bytea NOT NULL,
    "userId" uuid NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    permissions character varying[] NOT NULL,
    "updateId" uuid DEFAULT public.immich_uuid_v7() NOT NULL
);


--
-- Name: asset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "ownerId" uuid NOT NULL,
    type character varying NOT NULL,
    "originalPath" character varying NOT NULL,
    "fileCreatedAt" timestamp with time zone NOT NULL,
    "fileModifiedAt" timestamp with time zone NOT NULL,
    "isFavorite" boolean DEFAULT false NOT NULL,
    duration integer,
    checksum bytea NOT NULL,
    "livePhotoVideoId" uuid,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "originalFileName" character varying NOT NULL,
    thumbhash bytea,
    "isOffline" boolean DEFAULT false NOT NULL,
    "libraryId" uuid,
    "isExternal" boolean DEFAULT false NOT NULL,
    "deletedAt" timestamp with time zone,
    "localDateTime" timestamp with time zone NOT NULL,
    "stackId" uuid,
    "duplicateId" uuid,
    status public.assets_status_enum DEFAULT 'active'::public.assets_status_enum NOT NULL,
    "updateId" uuid DEFAULT public.immich_uuid_v7() NOT NULL,
    visibility public.asset_visibility_enum DEFAULT 'timeline'::public.asset_visibility_enum NOT NULL,
    width integer,
    height integer,
    "isEdited" boolean DEFAULT false NOT NULL,
    "checksumAlgorithm" public.asset_checksum_algorithm_enum NOT NULL
);


--
-- Name: asset_audio; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_audio (
    "assetId" uuid NOT NULL,
    bitrate integer NOT NULL,
    index smallint NOT NULL,
    profile smallint,
    "codecName" text NOT NULL
);


--
-- Name: asset_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_audit (
    id uuid DEFAULT public.immich_uuid_v7() NOT NULL,
    "assetId" uuid NOT NULL,
    "ownerId" uuid NOT NULL,
    "deletedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: asset_edit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_edit (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "assetId" uuid NOT NULL,
    action character varying NOT NULL,
    parameters jsonb NOT NULL,
    sequence integer NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updateId" uuid DEFAULT public.immich_uuid_v7() NOT NULL
);


--
-- Name: asset_edit_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_edit_audit (
    id uuid DEFAULT public.immich_uuid_v7() NOT NULL,
    "editId" uuid NOT NULL,
    "assetId" uuid NOT NULL,
    "deletedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: asset_exif; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_exif (
    "assetId" uuid NOT NULL,
    make character varying,
    model character varying,
    "exifImageWidth" integer,
    "exifImageHeight" integer,
    "fileSizeInByte" bigint,
    orientation character varying,
    "dateTimeOriginal" timestamp with time zone,
    "modifyDate" timestamp with time zone,
    "lensModel" character varying,
    "fNumber" double precision,
    "focalLength" double precision,
    iso integer,
    latitude double precision,
    longitude double precision,
    city character varying,
    state character varying,
    country character varying,
    description text DEFAULT ''::text NOT NULL,
    fps double precision,
    "exposureTime" character varying,
    "livePhotoCID" character varying,
    "timeZone" character varying,
    "projectionType" character varying,
    "profileDescription" character varying,
    colorspace character varying,
    "bitsPerSample" integer,
    "autoStackId" character varying,
    rating integer,
    "updatedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    "updateId" uuid DEFAULT public.immich_uuid_v7() NOT NULL,
    "lockedProperties" character varying[],
    tags character varying[]
);


--
-- Name: asset_face; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_face (
    "assetId" uuid NOT NULL,
    "personGroupId" uuid,
    "imageWidth" integer DEFAULT 0 NOT NULL,
    "imageHeight" integer DEFAULT 0 NOT NULL,
    "boundingBoxX1" integer DEFAULT 0 NOT NULL,
    "boundingBoxY1" integer DEFAULT 0 NOT NULL,
    "boundingBoxX2" integer DEFAULT 0 NOT NULL,
    "boundingBoxY2" integer DEFAULT 0 NOT NULL,
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "sourceType" public.sourcetype DEFAULT 'machine-learning'::public.sourcetype NOT NULL,
    "deletedAt" timestamp with time zone,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updateId" uuid DEFAULT public.immich_uuid_v7() NOT NULL,
    "isVisible" boolean DEFAULT true NOT NULL,
    "ownerId" uuid NOT NULL,
    "assetVisibility" public.asset_visibility_enum NOT NULL,
    "assetDeletedAt" timestamp with time zone
);


--
-- Name: asset_face_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_face_audit (
    id uuid DEFAULT public.immich_uuid_v7() NOT NULL,
    "assetFaceId" uuid NOT NULL,
    "assetId" uuid NOT NULL,
    "deletedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: asset_file; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_file (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "assetId" uuid NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    type character varying NOT NULL,
    path character varying NOT NULL,
    "updateId" uuid DEFAULT public.immich_uuid_v7() NOT NULL,
    "isEdited" boolean DEFAULT false NOT NULL,
    "isProgressive" boolean DEFAULT false NOT NULL,
    "isTransparent" boolean DEFAULT false NOT NULL
);


--
-- Name: asset_job_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_job_status (
    "assetId" uuid NOT NULL,
    "facesRecognizedAt" timestamp with time zone,
    "metadataExtractedAt" timestamp with time zone,
    "duplicatesDetectedAt" timestamp with time zone,
    "ocrAt" timestamp with time zone
);


--
-- Name: asset_keyframe; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_keyframe (
    "assetId" uuid NOT NULL,
    pts integer[] NOT NULL,
    "accDuration" integer[] NOT NULL,
    "ownDuration" integer[] NOT NULL,
    "totalDuration" integer NOT NULL,
    "packetCount" integer NOT NULL,
    "outputFrames" integer NOT NULL
);


--
-- Name: asset_metadata; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_metadata (
    "assetId" uuid NOT NULL,
    key character varying NOT NULL,
    value jsonb NOT NULL,
    "updateId" uuid DEFAULT public.immich_uuid_v7() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_metadata_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_metadata_audit (
    id uuid DEFAULT public.immich_uuid_v7() NOT NULL,
    "assetId" uuid NOT NULL,
    key character varying NOT NULL,
    "deletedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: asset_ocr; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_ocr (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "assetId" uuid NOT NULL,
    x1 real NOT NULL,
    y1 real NOT NULL,
    x2 real NOT NULL,
    y2 real NOT NULL,
    x3 real NOT NULL,
    y3 real NOT NULL,
    x4 real NOT NULL,
    y4 real NOT NULL,
    "boxScore" real NOT NULL,
    "textScore" real NOT NULL,
    text text NOT NULL,
    "isVisible" boolean DEFAULT true NOT NULL,
    "updateId" uuid DEFAULT public.immich_uuid_v7() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_ocr_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_ocr_audit (
    id uuid DEFAULT public.immich_uuid_v7() NOT NULL,
    "assetId" uuid NOT NULL,
    "deletedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: asset_video; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_video (
    "assetId" uuid NOT NULL,
    bitrate integer NOT NULL,
    "frameCount" integer NOT NULL,
    "timeBase" integer NOT NULL,
    index smallint NOT NULL,
    profile smallint,
    level smallint,
    "colorPrimaries" smallint NOT NULL,
    "colorTransfer" smallint NOT NULL,
    "colorMatrix" smallint NOT NULL,
    "dvProfile" smallint,
    "dvLevel" smallint,
    "dvBlSignalCompatibilityId" smallint,
    "codecName" text NOT NULL,
    "formatName" text NOT NULL,
    "formatLongName" text NOT NULL,
    "pixelFormat" text NOT NULL
);


--
-- Name: cluster_group; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cluster_group (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updateId" uuid DEFAULT public.immich_uuid_v7() NOT NULL
);


--
-- Name: cluster_group_request; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cluster_group_request (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "clusterGroupId" uuid NOT NULL,
    "userId" uuid NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: face_search; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.face_search (
    "faceId" uuid NOT NULL,
    embedding public.vector(512) NOT NULL
);


--
-- Name: geodata_places; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.geodata_places (
    id integer NOT NULL,
    name character varying(200) NOT NULL,
    longitude double precision NOT NULL,
    latitude double precision NOT NULL,
    "countryCode" character(2) NOT NULL,
    "admin1Code" character varying(20),
    "admin2Code" character varying(80),
    "modificationDate" date NOT NULL,
    "admin1Name" character varying,
    "admin2Name" character varying,
    "alternateNames" character varying
);


--
-- Name: integrity_report; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integrity_report (
    id uuid DEFAULT public.immich_uuid_v7() NOT NULL,
    type character varying NOT NULL,
    path character varying NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "assetId" uuid,
    "fileAssetId" uuid
);


--
-- Name: kysely_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kysely_migrations (
    name character varying(255) NOT NULL,
    "timestamp" character varying(255) NOT NULL
);


--
-- Name: kysely_migrations_lock; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kysely_migrations_lock (
    id character varying(255) NOT NULL,
    is_locked integer DEFAULT 0 NOT NULL
);


--
-- Name: library; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.library (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying NOT NULL,
    "ownerId" uuid NOT NULL,
    "importPaths" text[] NOT NULL,
    "exclusionPatterns" text[] NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "deletedAt" timestamp with time zone,
    "refreshedAt" timestamp with time zone,
    "updateId" uuid DEFAULT public.immich_uuid_v7() NOT NULL
);


--
-- Name: memory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memory (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "deletedAt" timestamp with time zone,
    "ownerId" uuid NOT NULL,
    type character varying NOT NULL,
    data jsonb NOT NULL,
    "isSaved" boolean DEFAULT false NOT NULL,
    "memoryAt" timestamp with time zone NOT NULL,
    "seenAt" timestamp with time zone,
    "showAt" timestamp with time zone,
    "hideAt" timestamp with time zone,
    "updateId" uuid DEFAULT public.immich_uuid_v7() NOT NULL
);


--
-- Name: memory_asset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memory_asset (
    "memoriesId" uuid NOT NULL,
    "assetId" uuid NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updateId" uuid DEFAULT public.immich_uuid_v7() NOT NULL
);


--
-- Name: memory_asset_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memory_asset_audit (
    id uuid DEFAULT public.immich_uuid_v7() NOT NULL,
    "memoryId" uuid NOT NULL,
    "assetId" uuid NOT NULL,
    "deletedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: memory_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memory_audit (
    id uuid DEFAULT public.immich_uuid_v7() NOT NULL,
    "memoryId" uuid NOT NULL,
    "userId" uuid NOT NULL,
    "deletedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: migration_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.migration_overrides (
    name character varying NOT NULL,
    value jsonb NOT NULL
);


--
-- Name: move_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.move_history (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "entityId" uuid NOT NULL,
    "pathType" character varying NOT NULL,
    "oldPath" character varying NOT NULL,
    "newPath" character varying NOT NULL
);


--
-- Name: naturalearth_countries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.naturalearth_countries (
    id integer NOT NULL,
    admin character varying(50) NOT NULL,
    admin_a3 character varying(3) NOT NULL,
    type character varying(50) NOT NULL,
    coordinates polygon NOT NULL
);


--
-- Name: naturalearth_countries_tmp_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.naturalearth_countries ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.naturalearth_countries_tmp_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1
);


--
-- Name: notification; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "deletedAt" timestamp with time zone,
    "updateId" uuid DEFAULT public.immich_uuid_v7() NOT NULL,
    "userId" uuid,
    level character varying DEFAULT 'info'::character varying NOT NULL,
    type character varying DEFAULT 'info'::character varying NOT NULL,
    data jsonb,
    title character varying NOT NULL,
    description text,
    "readAt" timestamp with time zone
);


--
-- Name: ocr_search; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ocr_search (
    "assetId" uuid NOT NULL,
    text text NOT NULL
);


--
-- Name: partner; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.partner (
    "sharedById" uuid NOT NULL,
    "sharedWithId" uuid NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "inTimeline" boolean DEFAULT false NOT NULL,
    "updateId" uuid DEFAULT public.immich_uuid_v7() NOT NULL,
    "createId" uuid DEFAULT public.immich_uuid_v7() NOT NULL
);


--
-- Name: partner_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.partner_audit (
    id uuid DEFAULT public.immich_uuid_v7() NOT NULL,
    "sharedById" uuid NOT NULL,
    "sharedWithId" uuid NOT NULL,
    "deletedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: person; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.person (
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "ownerId" uuid NOT NULL,
    name character varying DEFAULT ''::character varying NOT NULL,
    "thumbnailPath" character varying DEFAULT ''::character varying NOT NULL,
    "isHidden" boolean DEFAULT false NOT NULL,
    "birthDate" date,
    "faceAssetId" uuid,
    "isFavorite" boolean DEFAULT false NOT NULL,
    color character varying,
    "updateId" uuid DEFAULT public.immich_uuid_v7() NOT NULL,
    "personGroupId" uuid NOT NULL,
    CONSTRAINT "person_birthDate_chk" CHECK (("birthDate" <= CURRENT_DATE))
);


--
-- Name: person_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.person_audit (
    id uuid DEFAULT public.immich_uuid_v7() NOT NULL,
    "ownerId" uuid NOT NULL,
    "deletedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    "personGroupId" uuid NOT NULL
);


--
-- Name: person_group; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.person_group (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "clusterGroupId" uuid NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "createId" uuid DEFAULT public.immich_uuid_v7() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updateId" uuid DEFAULT public.immich_uuid_v7() NOT NULL
);


--
-- Name: person_group_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.person_group_audit (
    id uuid DEFAULT public.immich_uuid_v7() NOT NULL,
    "personGroupId" uuid NOT NULL,
    "clusterGroupId" uuid NOT NULL,
    "deletedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: person_user; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.person_user (
    "personGroupId" uuid NOT NULL,
    "sharedById" uuid NOT NULL,
    "sharedWithId" uuid NOT NULL,
    role public.person_user_role_enum NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updateId" uuid DEFAULT public.immich_uuid_v7() NOT NULL,
    CONSTRAINT "person_user_sharedBy_sharedWith_chk" CHECK (("sharedById" <> "sharedWithId"))
);


--
-- Name: pixelunion_session_token; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pixelunion_session_token (
    "sessionId" uuid NOT NULL,
    "keycloakRefreshToken" bytea NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updateId" uuid DEFAULT public.immich_uuid_v7() NOT NULL
);


--
-- Name: plugin; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plugin (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    name character varying NOT NULL,
    version character varying NOT NULL,
    title character varying NOT NULL,
    description character varying NOT NULL,
    author character varying NOT NULL,
    "wasmBytes" bytea NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    templates jsonb NOT NULL,
    sha256hash bytea NOT NULL
);


--
-- Name: plugin_method; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plugin_method (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "pluginId" uuid NOT NULL,
    name character varying NOT NULL,
    title character varying NOT NULL,
    description character varying NOT NULL,
    types character varying[] NOT NULL,
    "hostFunctions" boolean DEFAULT false NOT NULL,
    "uiHints" character varying[] DEFAULT '{}'::character varying[] NOT NULL,
    schema jsonb,
    "allowedHosts" character varying[] DEFAULT '{}'::character varying[] NOT NULL
);


--
-- Name: session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    token bytea NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "userId" uuid NOT NULL,
    "deviceType" character varying DEFAULT ''::character varying NOT NULL,
    "deviceOS" character varying DEFAULT ''::character varying NOT NULL,
    "updateId" uuid DEFAULT public.immich_uuid_v7() NOT NULL,
    "pinExpiresAt" timestamp with time zone,
    "expiresAt" timestamp with time zone,
    "parentId" uuid,
    "isPendingSyncReset" boolean DEFAULT false NOT NULL,
    "appVersion" character varying,
    "oauthSid" character varying,
    "oauthBearerToken" character varying
);


--
-- Name: session_sync_checkpoint; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_sync_checkpoint (
    "sessionId" uuid NOT NULL,
    type character varying NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    ack character varying NOT NULL,
    "updateId" uuid DEFAULT public.immich_uuid_v7() NOT NULL
);


--
-- Name: shared_link; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shared_link (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    description character varying,
    "userId" uuid NOT NULL,
    key bytea NOT NULL,
    type character varying NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "expiresAt" timestamp with time zone,
    "allowUpload" boolean DEFAULT false NOT NULL,
    "albumId" uuid,
    "allowDownload" boolean DEFAULT true NOT NULL,
    "showExif" boolean DEFAULT true NOT NULL,
    password character varying,
    slug character varying
);


--
-- Name: shared_link_asset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shared_link_asset (
    "assetId" uuid NOT NULL,
    "sharedLinkId" uuid NOT NULL
);


--
-- Name: smart_search; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.smart_search (
    "assetId" uuid NOT NULL,
    embedding public.vector(512) NOT NULL
);


--
-- Name: stack; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stack (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "primaryAssetId" uuid NOT NULL,
    "ownerId" uuid NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updateId" uuid DEFAULT public.immich_uuid_v7() NOT NULL
);


--
-- Name: stack_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stack_audit (
    id uuid DEFAULT public.immich_uuid_v7() NOT NULL,
    "stackId" uuid NOT NULL,
    "userId" uuid NOT NULL,
    "deletedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: system_metadata; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_metadata (
    key character varying NOT NULL,
    value jsonb NOT NULL
);


--
-- Name: tag; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tag (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "userId" uuid NOT NULL,
    value character varying NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    color character varying,
    "parentId" uuid,
    "updateId" uuid DEFAULT public.immich_uuid_v7() NOT NULL
);


--
-- Name: tag_asset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tag_asset (
    "assetId" uuid NOT NULL,
    "tagId" uuid NOT NULL
);


--
-- Name: tag_closure; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tag_closure (
    id_ancestor uuid NOT NULL,
    id_descendant uuid NOT NULL
);


--
-- Name: user; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."user" (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email character varying NOT NULL,
    password character varying,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "profileImagePath" character varying DEFAULT ''::character varying NOT NULL,
    "isAdmin" boolean DEFAULT false NOT NULL,
    "shouldChangePassword" boolean DEFAULT true NOT NULL,
    "deletedAt" timestamp with time zone,
    "oauthId" character varying,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "storageLabel" character varying,
    name character varying DEFAULT ''::character varying NOT NULL,
    "quotaSizeInBytes" bigint,
    "quotaUsageInBytes" bigint DEFAULT 0 NOT NULL,
    status character varying DEFAULT 'active'::character varying NOT NULL,
    "profileChangedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updateId" uuid DEFAULT public.immich_uuid_v7() NOT NULL,
    "avatarColor" character varying,
    "pinCode" character varying,
    "clusterGroupId" uuid NOT NULL
);


--
-- Name: user_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_audit (
    "userId" uuid NOT NULL,
    "deletedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    id uuid DEFAULT public.immich_uuid_v7() NOT NULL
);


--
-- Name: user_metadata; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_metadata (
    "userId" uuid NOT NULL,
    key character varying NOT NULL,
    value jsonb NOT NULL,
    "updateId" uuid DEFAULT public.immich_uuid_v7() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_metadata_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_metadata_audit (
    id uuid DEFAULT public.immich_uuid_v7() NOT NULL,
    "userId" uuid NOT NULL,
    key character varying NOT NULL,
    "deletedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: version_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.version_history (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    version character varying NOT NULL
);


--
-- Name: video_stream_segment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.video_stream_segment (
    "variantId" uuid NOT NULL,
    index integer NOT NULL,
    "durationUs" integer NOT NULL
);


--
-- Name: video_stream_session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.video_stream_session (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "assetId" uuid NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: video_stream_variant; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.video_stream_variant (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "sessionId" uuid NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    bitrate integer NOT NULL,
    codec public.video_stream_variant_codec_enum NOT NULL,
    resolution smallint NOT NULL
);


--
-- Name: workflow; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "ownerId" uuid NOT NULL,
    trigger character varying NOT NULL,
    name character varying,
    description character varying,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updateId" uuid DEFAULT public.immich_uuid_v7() NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    logging boolean DEFAULT false NOT NULL
);


--
-- Name: workflow_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_log (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "workflowId" uuid NOT NULL,
    result character varying NOT NULL,
    "workflowStepId" uuid,
    "triggerDataId" uuid,
    "runId" uuid NOT NULL
);


--
-- Name: workflow_step; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_step (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    "workflowId" uuid NOT NULL,
    "pluginMethodId" uuid NOT NULL,
    config jsonb,
    "order" integer NOT NULL
);


--
-- Data for Name: activity; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.activity (id, "createdAt", "updatedAt", "albumId", "userId", "assetId", comment, "isLiked", "updateId") FROM stdin;
\.


--
-- Data for Name: album; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.album (id, "albumName", "createdAt", "albumThumbnailAssetId", "updatedAt", description, "deletedAt", "isActivityEnabled", "order", "updateId") FROM stdin;
\.


--
-- Data for Name: album_asset; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.album_asset ("albumId", "assetId", "createdAt", "updatedAt", "updateId") FROM stdin;
\.


--
-- Data for Name: album_asset_audit; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.album_asset_audit (id, "albumId", "assetId", "deletedAt") FROM stdin;
\.


--
-- Data for Name: album_audit; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.album_audit (id, "albumId", "userId", "deletedAt") FROM stdin;
\.


--
-- Data for Name: album_user; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.album_user ("albumId", "userId", role, "updateId", "updatedAt", "createId", "createdAt") FROM stdin;
\.


--
-- Data for Name: album_user_audit; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.album_user_audit (id, "albumId", "userId", "deletedAt") FROM stdin;
\.


--
-- Data for Name: api_key; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.api_key (name, key, "userId", "createdAt", "updatedAt", id, permissions, "updateId") FROM stdin;
\.


--
-- Data for Name: asset; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.asset (id, "ownerId", type, "originalPath", "fileCreatedAt", "fileModifiedAt", "isFavorite", duration, checksum, "livePhotoVideoId", "updatedAt", "createdAt", "originalFileName", thumbhash, "isOffline", "libraryId", "isExternal", "deletedAt", "localDateTime", "stackId", "duplicateId", status, "updateId", visibility, width, height, "isEdited", "checksumAlgorithm") FROM stdin;
\.


--
-- Data for Name: asset_audio; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.asset_audio ("assetId", bitrate, index, profile, "codecName") FROM stdin;
\.


--
-- Data for Name: asset_audit; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.asset_audit (id, "assetId", "ownerId", "deletedAt") FROM stdin;
\.


--
-- Data for Name: asset_edit; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.asset_edit (id, "assetId", action, parameters, sequence, "updatedAt", "updateId") FROM stdin;
\.


--
-- Data for Name: asset_edit_audit; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.asset_edit_audit (id, "editId", "assetId", "deletedAt") FROM stdin;
\.


--
-- Data for Name: asset_exif; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.asset_exif ("assetId", make, model, "exifImageWidth", "exifImageHeight", "fileSizeInByte", orientation, "dateTimeOriginal", "modifyDate", "lensModel", "fNumber", "focalLength", iso, latitude, longitude, city, state, country, description, fps, "exposureTime", "livePhotoCID", "timeZone", "projectionType", "profileDescription", colorspace, "bitsPerSample", "autoStackId", rating, "updatedAt", "updateId", "lockedProperties", tags) FROM stdin;
\.


--
-- Data for Name: asset_face; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.asset_face ("assetId", "personGroupId", "imageWidth", "imageHeight", "boundingBoxX1", "boundingBoxY1", "boundingBoxX2", "boundingBoxY2", id, "sourceType", "deletedAt", "updatedAt", "updateId", "isVisible", "ownerId", "assetVisibility", "assetDeletedAt") FROM stdin;
\.


--
-- Data for Name: asset_face_audit; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.asset_face_audit (id, "assetFaceId", "assetId", "deletedAt") FROM stdin;
\.


--
-- Data for Name: asset_file; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.asset_file (id, "assetId", "createdAt", "updatedAt", type, path, "updateId", "isEdited", "isProgressive", "isTransparent") FROM stdin;
\.


--
-- Data for Name: asset_job_status; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.asset_job_status ("assetId", "facesRecognizedAt", "metadataExtractedAt", "duplicatesDetectedAt", "ocrAt") FROM stdin;
\.


--
-- Data for Name: asset_keyframe; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.asset_keyframe ("assetId", pts, "accDuration", "ownDuration", "totalDuration", "packetCount", "outputFrames") FROM stdin;
\.


--
-- Data for Name: asset_metadata; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.asset_metadata ("assetId", key, value, "updateId", "updatedAt") FROM stdin;
\.


--
-- Data for Name: asset_metadata_audit; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.asset_metadata_audit (id, "assetId", key, "deletedAt") FROM stdin;
\.


--
-- Data for Name: asset_ocr; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.asset_ocr (id, "assetId", x1, y1, x2, y2, x3, y3, x4, y4, "boxScore", "textScore", text, "isVisible", "updateId", "updatedAt") FROM stdin;
\.


--
-- Data for Name: asset_ocr_audit; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.asset_ocr_audit (id, "assetId", "deletedAt") FROM stdin;
\.


--
-- Data for Name: asset_video; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.asset_video ("assetId", bitrate, "frameCount", "timeBase", index, profile, level, "colorPrimaries", "colorTransfer", "colorMatrix", "dvProfile", "dvLevel", "dvBlSignalCompatibilityId", "codecName", "formatName", "formatLongName", "pixelFormat") FROM stdin;
\.


--
-- Data for Name: cluster_group; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.cluster_group (id, name, "createdAt", "updatedAt", "updateId") FROM stdin;
\.


--
-- Data for Name: cluster_group_request; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.cluster_group_request (id, "clusterGroupId", "userId", "createdAt") FROM stdin;
\.


--
-- Data for Name: face_search; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.face_search ("faceId", embedding) FROM stdin;
\.


--
-- Data for Name: integrity_report; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.integrity_report (id, type, path, "createdAt", "assetId", "fileAssetId") FROM stdin;
\.


--
-- Data for Name: kysely_migrations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.kysely_migrations (name, "timestamp") FROM stdin;
1744910873969-InitialMigration	2026-11-27T14:59:28.731Z
1744991379464-AddNotificationsTable	2026-11-27T14:59:28.736Z
1745244781846-AddUserAvatarColorColumn	2026-11-27T14:59:28.738Z
1745902563899-AddAssetVisibilityColumn	2026-11-27T14:59:28.745Z
1746636476623-DropExtraIndexes	2026-11-27T14:59:28.758Z
1746768490606-AddUserPincode	2026-11-27T14:59:28.759Z
1746844028242-AddLockedVisibilityEnum	2026-11-27T14:59:28.760Z
1746987967923-AddPinExpiresAtColumn	2026-11-27T14:59:28.761Z
1747329504572-AddNewSessionColumns	2026-11-27T14:59:28.767Z
1747338664832-SessionRename	2026-11-27T14:59:28.770Z
1747664684909-AddAlbumAuditTables	2026-11-27T14:59:28.861Z
1749067526135-UserOnboardingDefault	2026-11-27T14:59:28.867Z
1750107668827-PartnerCreateId	2026-11-27T14:59:28.872Z
1750189909087-AddAlbumUserCreateFields	2026-11-27T14:59:28.887Z
1750323941566-UnsetPrewarmDimParameter	2026-11-27T14:59:28.888Z
1750676477029-AlbumAssetUpdateId	2026-11-27T14:59:28.952Z
1750694237564-AlbumAssetAuditTable	2026-11-27T14:59:28.967Z
1750780093818-AddAlbumToAssetDeleteTrigger	2026-11-27T14:59:28.974Z
1751035357937-MemorySyncChanges	2026-11-27T14:59:29.023Z
1751304834247-StackSyncChanges	2026-11-27T14:59:29.038Z
1751924596408-AddOverrides	2026-11-27T14:59:29.102Z
1752004072340-UpdateIndexOverrides	2026-11-27T14:59:29.109Z
1752152941084-PeopleAuditTable	2026-11-27T14:59:29.152Z
1752161055253-RenameGeodataPKConstraint	2026-11-27T14:59:29.173Z
1752161055254-AddActivityAssetFk	2026-11-27T14:59:29.176Z
1752169992364-AddIsPendingSyncReset	2026-11-27T14:59:29.178Z
1752250924342-UserMetadataSync	2026-11-27T14:59:29.195Z
1752267649968-StandardizeNames	2026-11-27T14:59:29.366Z
1752759108283-ConvertToAbsolutePaths	2026-11-27T14:59:29.380Z
1753104909784-AssetFaceUpdateIdAndAuditTable	2026-11-27T14:59:29.415Z
1753464178233-RenameApiKeyPermissions	2026-11-27T14:59:29.419Z
1753471866748-AddSharedLinkSlug	2026-11-27T14:59:29.424Z
1753800911775-ProfileImageCheckpointRemoval	2026-11-27T14:59:29.426Z
1754389095885-ResetAlbumAssetSync	2026-11-27T14:59:29.428Z
1756318797207-AssetMetadataTables	2026-11-27T14:59:29.466Z
1758705774125-CreateAssetOCRTable	2026-11-27T14:59:29.473Z
1758705789125-CreateOCRSearchTable	2026-11-27T14:59:29.479Z
1758705804128-UpsertOcrAssetJobStatus	2026-11-27T14:59:29.481Z
1761078763279-AddAppVersionColumnToSession	2026-11-27T14:59:29.482Z
1761755618862-FixColumnNames	2026-11-27T14:59:29.496Z
1762297277677-AddPluginAndWorkflowTables	2026-11-27T14:59:29.535Z
1764483051488-OCRBigramsForCJK	2026-11-27T14:59:29.549Z
1764698859174-SidecarInAssetFile	2026-11-27T14:59:29.558Z
1764705680041-ChangeWorkflowTableColumnsName	2026-11-27T14:59:29.568Z
1764957138636-AddLockedPropertiesToAssetExif	2026-11-27T14:59:29.569Z
1768336661963-AddAssetWidthHeight	2026-11-27T14:59:29.570Z
1768336671610-CreateAssetEditTable	2026-11-27T14:59:29.578Z
1768336694315-CreateIsVisibleColumns	2026-11-27T14:59:29.580Z
1768587436457-AddEditCountToAsset	2026-11-27T14:59:29.583Z
1768757482271-SwitchToIsEdited	2026-11-27T14:59:29.586Z
1768828334807-AddIsEditedToAssetFile	2026-11-27T14:59:29.588Z
1768847456553-AddTagsToExif	2026-11-27T14:59:29.589Z
1769105700133-AddAssetEditSequence	2026-11-27T14:59:29.592Z
1769441657564-AddIsProgressiveColumn	2026-11-27T14:59:29.593Z
1769635093204-DropThumbnailJobStatusColumns	2026-11-27T14:59:29.593Z
1771478781948-PeopleSearchIndex	2026-11-27T14:59:29.595Z
1771535611395-ConvertRating0ToNull	2026-11-27T14:59:29.596Z
1771639515206-AddIsTransparentColumn	2026-11-27T14:59:29.597Z
1771873044511-ChangesTokensToBuffers	2026-11-27T14:59:29.604Z
1771873813973-AssetEditSync	2026-11-27T14:59:29.611Z
1772121424533-AddAssetExifGistEarthcoord	2026-11-27T14:59:29.614Z
1772129818245-FixStupidWhiteSpace	2026-11-27T14:59:29.618Z
1772609167000-UpdateOpusCodecName	2026-11-27T14:59:29.620Z
1773242919341-EncodedVideoAssetFiles	2026-11-27T14:59:29.621Z
1773956345315-DuplicateSharedLinkAssets	2026-11-27T14:59:29.622Z
1774393726320-AssetFaceSyncReset	2026-11-27T14:59:29.623Z
1774548649115-AddChecksumAlgorithm.ts	2026-11-27T14:59:29.627Z
1775165531374-AddPersonNameTrigramIndex	2026-11-27T14:59:29.631Z
1775200000000-AddPixelUnionSessionToken	2026-11-27T14:59:29.641Z
1776217577402-DropAuditTable	2026-11-27T14:59:29.645Z
1776263790468-DropDeviceIdAndDeviceAssetId	2026-11-27T14:59:29.648Z
1776332807985-SetOAuthAllowInsecureRequests	2026-11-27T14:59:29.649Z
1776442031775-AddOauthSidToSession	2026-11-27T14:59:29.653Z
1776792304485-ReconcileSqlToolsUpgradeChanges	2026-11-27T14:59:29.658Z
1776848612954-MigrateAlbumOwnerIdToAlbumUser	2026-11-27T14:59:29.676Z
1777415973792-AddVideoStreamTables	2026-11-27T14:59:29.687Z
1777654048096-CreateAudioVideoTables	2026-11-27T14:59:29.697Z
1777667825574-ChangeDurationToInteger	2026-11-27T14:59:29.708Z
1777897107000-PartnerAssetSyncReset	2026-11-27T14:59:29.710Z
1778614946174-UpdateWorkflowTables	2026-11-27T14:59:29.749Z
1779806699547-AddPluginTemplates	2026-11-27T14:59:29.753Z
1780435471692-DeleteMismatchedAssetFaces	2026-11-27T14:59:29.758Z
1780592070031-ConvertNegativeRatingToNull	2026-11-27T14:59:29.760Z
1780592071031-AssetOcrSync	2026-11-27T14:59:29.771Z
1781089983296-CreateIntegrityReportTable	2026-11-27T14:59:29.781Z
1782414436633-AddPluginMethodAllowedHosts	2026-11-27T14:59:29.783Z
1782500000000-RestoreLivePhotoStillVisibility	2026-11-27T14:59:29.787Z
1784647658615-AddOAuthBearerTokenToSession	2026-11-27T14:59:29.789Z
1784836013770-MinFacePreferenceMigration	2026-11-27T14:59:29.792Z
1784986754473-ConvertUserPasswordEmptyStringToNull	2026-11-27T14:59:29.794Z
1784986754474-AlbumDescriptionNullable	2026-11-27T14:59:29.796Z
1786385711807-AlbumOwnerDeleteTrigger	2026-11-27T14:59:29.801Z
1786741078327-AddWorkflowLogsTable	2026-11-27T14:59:29.813Z
1786972746371-AssetOcrUpdatedAtTrigger	2026-11-27T14:59:29.814Z
1786972746372-AssetOcrSyncReset	2026-11-27T14:59:29.814Z
1787148183729-ClusterGroups	2026-11-27T14:59:29.848Z
1787148183730-DeleteMismatchedMemoryAssets	2026-11-27T14:59:29.853Z
1789419229196-ConvertUserOAuthIdEmptyStringToNull	2026-11-27T14:59:29.855Z
1790587508209-RenameGeoNamesCountries	2026-11-27T14:59:29.857Z
1790616293884-PersonSharing	2026-11-27T14:59:29.875Z
1790693088454-AddPersonUserTableSharedBySharedWithConstraint	2026-11-27T14:59:29.876Z
1792213725597-AddAssetFaceAssetState	2026-11-27T14:59:29.889Z
\.


--
-- Data for Name: kysely_migrations_lock; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.kysely_migrations_lock (id, is_locked) FROM stdin;
migration_lock	0
\.


--
-- Data for Name: library; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.library (id, name, "ownerId", "importPaths", "exclusionPatterns", "createdAt", "updatedAt", "deletedAt", "refreshedAt", "updateId") FROM stdin;
\.


--
-- Data for Name: memory; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.memory (id, "createdAt", "updatedAt", "deletedAt", "ownerId", type, data, "isSaved", "memoryAt", "seenAt", "showAt", "hideAt", "updateId") FROM stdin;
\.


--
-- Data for Name: memory_asset; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.memory_asset ("memoriesId", "assetId", "createdAt", "updatedAt", "updateId") FROM stdin;
\.


--
-- Data for Name: memory_asset_audit; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.memory_asset_audit (id, "memoryId", "assetId", "deletedAt") FROM stdin;
\.


--
-- Data for Name: memory_audit; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.memory_audit (id, "memoryId", "userId", "deletedAt") FROM stdin;
\.


--
-- Data for Name: migration_overrides; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.migration_overrides (name, value) FROM stdin;
function_immich_uuid_v7	{"sql": "CREATE OR REPLACE FUNCTION immich_uuid_v7(p_timestamp timestamp with time zone default clock_timestamp())\\n  RETURNS uuid\\n  VOLATILE LANGUAGE SQL\\n  AS $$\\n    SELECT encode(\\n      set_bit(\\n        set_bit(\\n          overlay(uuid_send(gen_random_uuid())\\n                  placing substring(int8send(floor(extract(epoch from p_timestamp) * 1000)::bigint) from 3)\\n                  from 1 for 6\\n          ),\\n          52, 1\\n        ),\\n        53, 1\\n      ),\\n      'hex')::uuid;\\n  $$;", "name": "immich_uuid_v7", "type": "function"}
function_updated_at	{"sql": "CREATE OR REPLACE FUNCTION updated_at()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    DECLARE\\n        clock_timestamp TIMESTAMP := clock_timestamp();\\n    BEGIN\\n        new.\\"updatedAt\\" = clock_timestamp;\\n        new.\\"updateId\\" = immich_uuid_v7(clock_timestamp);\\n        return new;\\n    END;\\n  $$;", "name": "updated_at", "type": "function"}
function_f_concat_ws	{"sql": "CREATE OR REPLACE FUNCTION f_concat_ws(text, text[])\\n  RETURNS text\\n  PARALLEL SAFE IMMUTABLE LANGUAGE SQL\\n  AS $$SELECT array_to_string($2, $1)$$;", "name": "f_concat_ws", "type": "function"}
function_f_unaccent	{"sql": "CREATE OR REPLACE FUNCTION f_unaccent(text)\\n  RETURNS text\\n  PARALLEL SAFE STRICT IMMUTABLE LANGUAGE SQL\\n    RETURN unaccent('unaccent', $1)", "name": "f_unaccent", "type": "function"}
function_ll_to_earth_public	{"sql": "CREATE OR REPLACE FUNCTION ll_to_earth_public(latitude double precision, longitude double precision)\\n  RETURNS public.earth\\n  PARALLEL SAFE STRICT IMMUTABLE LANGUAGE SQL\\n  AS $$SELECT public.cube(public.cube(public.cube(public.earth()*cos(radians(latitude))*cos(radians(longitude))),public.earth()*cos(radians(latitude))*sin(radians(longitude))),public.earth()*sin(radians(latitude)))::public.earth$$;", "name": "ll_to_earth_public", "type": "function"}
index_face_index	{"sql": "CREATE INDEX \\"face_index\\" ON \\"face_search\\" USING hnsw (embedding vector_cosine_ops) WITH (ef_construction = 300, m = 16);", "name": "face_index", "type": "index"}
index_IDX_geodata_gist_earthcoord	{"sql": "CREATE INDEX \\"IDX_geodata_gist_earthcoord\\" ON \\"geodata_places\\" (ll_to_earth_public(latitude, longitude));", "name": "IDX_geodata_gist_earthcoord", "type": "index"}
index_idx_geodata_places_name	{"sql": "CREATE INDEX \\"idx_geodata_places_name\\" ON \\"geodata_places\\" USING gin (f_unaccent(\\"name\\") gin_trgm_ops);", "name": "idx_geodata_places_name", "type": "index"}
index_idx_geodata_places_admin2_name	{"sql": "CREATE INDEX \\"idx_geodata_places_admin2_name\\" ON \\"geodata_places\\" USING gin (f_unaccent(\\"admin2Name\\") gin_trgm_ops);", "name": "idx_geodata_places_admin2_name", "type": "index"}
index_idx_geodata_places_admin1_name	{"sql": "CREATE INDEX \\"idx_geodata_places_admin1_name\\" ON \\"geodata_places\\" USING gin (f_unaccent(\\"admin1Name\\") gin_trgm_ops);", "name": "idx_geodata_places_admin1_name", "type": "index"}
index_idx_geodata_places_alternate_names	{"sql": "CREATE INDEX \\"idx_geodata_places_alternate_names\\" ON \\"geodata_places\\" USING gin (f_unaccent(\\"alternateNames\\") gin_trgm_ops);", "name": "idx_geodata_places_alternate_names", "type": "index"}
function_user_metadata_audit	{"sql": "CREATE OR REPLACE FUNCTION user_metadata_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO user_metadata_audit (\\"userId\\", \\"key\\")\\n      SELECT \\"userId\\", \\"key\\"\\n      FROM OLD;\\n      RETURN NULL;\\n    END\\n  $$;", "name": "user_metadata_audit", "type": "function"}
trigger_user_metadata_audit	{"sql": "CREATE OR REPLACE TRIGGER \\"user_metadata_audit\\"\\n  AFTER DELETE ON \\"user_metadata\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  WHEN (pg_trigger_depth() = 0)\\n  EXECUTE FUNCTION user_metadata_audit();", "name": "user_metadata_audit", "type": "trigger"}
trigger_user_metadata_updated_at	{"sql": "CREATE OR REPLACE TRIGGER \\"user_metadata_updated_at\\"\\n  BEFORE UPDATE ON \\"user_metadata\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();", "name": "user_metadata_updated_at", "type": "trigger"}
function_user_delete_audit	{"sql": "CREATE OR REPLACE FUNCTION user_delete_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO user_audit (\\"userId\\")\\n      SELECT \\"id\\"\\n      FROM OLD;\\n      RETURN NULL;\\n    END\\n  $$;", "name": "user_delete_audit", "type": "function"}
function_partner_delete_audit	{"sql": "CREATE OR REPLACE FUNCTION partner_delete_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO partner_audit (\\"sharedById\\", \\"sharedWithId\\")\\n      SELECT \\"sharedById\\", \\"sharedWithId\\"\\n      FROM OLD;\\n      RETURN NULL;\\n    END\\n  $$;", "name": "partner_delete_audit", "type": "function"}
function_asset_delete_audit	{"sql": "CREATE OR REPLACE FUNCTION asset_delete_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO asset_audit (\\"assetId\\", \\"ownerId\\")\\n      SELECT \\"id\\", \\"ownerId\\"\\n      FROM OLD;\\n      RETURN NULL;\\n    END\\n  $$;", "name": "asset_delete_audit", "type": "function"}
trigger_person_updatedAt	{"sql": "CREATE OR REPLACE TRIGGER \\"person_updatedAt\\"\\n  BEFORE UPDATE ON \\"person\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();", "name": "person_updatedAt", "type": "trigger"}
function_memory_delete_audit	{"sql": "CREATE OR REPLACE FUNCTION memory_delete_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO memory_audit (\\"memoryId\\", \\"userId\\")\\n      SELECT \\"id\\", \\"ownerId\\"\\n      FROM OLD;\\n      RETURN NULL;\\n    END\\n  $$;", "name": "memory_delete_audit", "type": "function"}
function_stack_delete_audit	{"sql": "CREATE OR REPLACE FUNCTION stack_delete_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO stack_audit (\\"stackId\\", \\"userId\\")\\n      SELECT \\"id\\", \\"ownerId\\"\\n      FROM OLD;\\n      RETURN NULL;\\n    END\\n  $$;", "name": "stack_delete_audit", "type": "function"}
trigger_user_delete_audit	{"sql": "CREATE OR REPLACE TRIGGER \\"user_delete_audit\\"\\n  AFTER DELETE ON \\"user\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  WHEN (pg_trigger_depth() = 0)\\n  EXECUTE FUNCTION user_delete_audit();", "name": "user_delete_audit", "type": "trigger"}
trigger_user_updatedAt	{"sql": "CREATE OR REPLACE TRIGGER \\"user_updatedAt\\"\\n  BEFORE UPDATE ON \\"user\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();", "name": "user_updatedAt", "type": "trigger"}
trigger_library_updatedAt	{"sql": "CREATE OR REPLACE TRIGGER \\"library_updatedAt\\"\\n  BEFORE UPDATE ON \\"library\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();", "name": "library_updatedAt", "type": "trigger"}
trigger_stack_delete_audit	{"sql": "CREATE OR REPLACE TRIGGER \\"stack_delete_audit\\"\\n  AFTER DELETE ON \\"stack\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  WHEN (pg_trigger_depth() = 0)\\n  EXECUTE FUNCTION stack_delete_audit();", "name": "stack_delete_audit", "type": "trigger"}
trigger_stack_updatedAt	{"sql": "CREATE OR REPLACE TRIGGER \\"stack_updatedAt\\"\\n  BEFORE UPDATE ON \\"stack\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();", "name": "stack_updatedAt", "type": "trigger"}
trigger_asset_delete_audit	{"sql": "CREATE OR REPLACE TRIGGER \\"asset_delete_audit\\"\\n  AFTER DELETE ON \\"asset\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  WHEN (pg_trigger_depth() = 0)\\n  EXECUTE FUNCTION asset_delete_audit();", "name": "asset_delete_audit", "type": "trigger"}
trigger_asset_updatedAt	{"sql": "CREATE OR REPLACE TRIGGER \\"asset_updatedAt\\"\\n  BEFORE UPDATE ON \\"asset\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();", "name": "asset_updatedAt", "type": "trigger"}
index_asset_originalFilename_trigram_idx	{"sql": "CREATE INDEX \\"asset_originalFilename_trigram_idx\\" ON \\"asset\\" USING gin (f_unaccent(\\"originalFileName\\") gin_trgm_ops);", "name": "asset_originalFilename_trigram_idx", "type": "index"}
index_asset_ownerId_libraryId_checksum_idx	{"sql": "CREATE UNIQUE INDEX \\"asset_ownerId_libraryId_checksum_idx\\" ON \\"asset\\" (\\"ownerId\\", \\"libraryId\\", \\"checksum\\") WHERE (\\"libraryId\\" IS NOT NULL);", "name": "asset_ownerId_libraryId_checksum_idx", "type": "index"}
trigger_album_updatedAt	{"sql": "CREATE OR REPLACE TRIGGER \\"album_updatedAt\\"\\n  BEFORE UPDATE ON \\"album\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();", "name": "album_updatedAt", "type": "trigger"}
trigger_album_asset_delete_audit	{"sql": "CREATE OR REPLACE TRIGGER \\"album_asset_delete_audit\\"\\n  AFTER DELETE ON \\"album_asset\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  WHEN (pg_trigger_depth() <= 1)\\n  EXECUTE FUNCTION album_asset_delete_audit();", "name": "album_asset_delete_audit", "type": "trigger"}
trigger_album_asset_updatedAt	{"sql": "CREATE OR REPLACE TRIGGER \\"album_asset_updatedAt\\"\\n  BEFORE UPDATE ON \\"album_asset\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();", "name": "album_asset_updatedAt", "type": "trigger"}
trigger_activity_updatedAt	{"sql": "CREATE OR REPLACE TRIGGER \\"activity_updatedAt\\"\\n  BEFORE UPDATE ON \\"activity\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();", "name": "activity_updatedAt", "type": "trigger"}
trigger_album_user_delete_audit	{"sql": "CREATE OR REPLACE TRIGGER \\"album_user_delete_audit\\"\\n  AFTER DELETE ON \\"album_user\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  WHEN (pg_trigger_depth() <= 1)\\n  EXECUTE FUNCTION album_user_delete_audit();", "name": "album_user_delete_audit", "type": "trigger"}
trigger_album_user_updatedAt	{"sql": "CREATE OR REPLACE TRIGGER \\"album_user_updatedAt\\"\\n  BEFORE UPDATE ON \\"album_user\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();", "name": "album_user_updatedAt", "type": "trigger"}
trigger_api_key_updatedAt	{"sql": "CREATE OR REPLACE TRIGGER \\"api_key_updatedAt\\"\\n  BEFORE UPDATE ON \\"api_key\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();", "name": "api_key_updatedAt", "type": "trigger"}
trigger_asset_exif_updatedAt	{"sql": "CREATE OR REPLACE TRIGGER \\"asset_exif_updatedAt\\"\\n  BEFORE UPDATE ON \\"asset_exif\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();", "name": "asset_exif_updatedAt", "type": "trigger"}
trigger_asset_file_updatedAt	{"sql": "CREATE OR REPLACE TRIGGER \\"asset_file_updatedAt\\"\\n  BEFORE UPDATE ON \\"asset_file\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();", "name": "asset_file_updatedAt", "type": "trigger"}
trigger_memory_delete_audit	{"sql": "CREATE OR REPLACE TRIGGER \\"memory_delete_audit\\"\\n  AFTER DELETE ON \\"memory\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  WHEN (pg_trigger_depth() = 0)\\n  EXECUTE FUNCTION memory_delete_audit();", "name": "memory_delete_audit", "type": "trigger"}
trigger_memory_updatedAt	{"sql": "CREATE OR REPLACE TRIGGER \\"memory_updatedAt\\"\\n  BEFORE UPDATE ON \\"memory\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();", "name": "memory_updatedAt", "type": "trigger"}
trigger_memory_asset_delete_audit	{"sql": "CREATE OR REPLACE TRIGGER \\"memory_asset_delete_audit\\"\\n  AFTER DELETE ON \\"memory_asset\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  WHEN (pg_trigger_depth() <= 1)\\n  EXECUTE FUNCTION memory_asset_delete_audit();", "name": "memory_asset_delete_audit", "type": "trigger"}
trigger_memory_asset_updatedAt	{"sql": "CREATE OR REPLACE TRIGGER \\"memory_asset_updatedAt\\"\\n  BEFORE UPDATE ON \\"memory_asset\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();", "name": "memory_asset_updatedAt", "type": "trigger"}
trigger_notification_updatedAt	{"sql": "CREATE OR REPLACE TRIGGER \\"notification_updatedAt\\"\\n  BEFORE UPDATE ON \\"notification\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();", "name": "notification_updatedAt", "type": "trigger"}
trigger_partner_delete_audit	{"sql": "CREATE OR REPLACE TRIGGER \\"partner_delete_audit\\"\\n  AFTER DELETE ON \\"partner\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  WHEN (pg_trigger_depth() = 0)\\n  EXECUTE FUNCTION partner_delete_audit();", "name": "partner_delete_audit", "type": "trigger"}
trigger_partner_updatedAt	{"sql": "CREATE OR REPLACE TRIGGER \\"partner_updatedAt\\"\\n  BEFORE UPDATE ON \\"partner\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();", "name": "partner_updatedAt", "type": "trigger"}
trigger_session_updatedAt	{"sql": "CREATE OR REPLACE TRIGGER \\"session_updatedAt\\"\\n  BEFORE UPDATE ON \\"session\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();", "name": "session_updatedAt", "type": "trigger"}
trigger_session_sync_checkpoint_updatedAt	{"sql": "CREATE OR REPLACE TRIGGER \\"session_sync_checkpoint_updatedAt\\"\\n  BEFORE UPDATE ON \\"session_sync_checkpoint\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();", "name": "session_sync_checkpoint_updatedAt", "type": "trigger"}
trigger_tag_updatedAt	{"sql": "CREATE OR REPLACE TRIGGER \\"tag_updatedAt\\"\\n  BEFORE UPDATE ON \\"tag\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();", "name": "tag_updatedAt", "type": "trigger"}
index_UQ_assets_owner_checksum	{"sql": "CREATE UNIQUE INDEX \\"UQ_assets_owner_checksum\\" ON \\"asset\\" (\\"ownerId\\", \\"checksum\\") WHERE (\\"libraryId\\" IS NULL);", "name": "UQ_assets_owner_checksum", "type": "index"}
trigger_album_user_after_insert	{"sql": "CREATE OR REPLACE TRIGGER \\"album_user_after_insert\\"\\n  AFTER INSERT ON \\"album_user\\"\\n  REFERENCING NEW TABLE AS \\"inserted_rows\\"\\n  FOR EACH STATEMENT\\n  EXECUTE FUNCTION album_user_after_insert();", "name": "album_user_after_insert", "type": "trigger"}
function_asset_face_audit	{"sql": "CREATE OR REPLACE FUNCTION asset_face_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO asset_face_audit (\\"assetFaceId\\", \\"assetId\\")\\n      SELECT \\"id\\", \\"assetId\\"\\n      FROM OLD;\\n      RETURN NULL;\\n    END\\n  $$;", "name": "asset_face_audit", "type": "function"}
trigger_asset_face_audit	{"sql": "CREATE OR REPLACE TRIGGER \\"asset_face_audit\\"\\n  AFTER DELETE ON \\"asset_face\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  WHEN (pg_trigger_depth() = 0)\\n  EXECUTE FUNCTION asset_face_audit();", "name": "asset_face_audit", "type": "trigger"}
function_asset_metadata_audit	{"sql": "CREATE OR REPLACE FUNCTION asset_metadata_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO asset_metadata_audit (\\"assetId\\", \\"key\\")\\n      SELECT \\"assetId\\", \\"key\\"\\n      FROM OLD;\\n      RETURN NULL;\\n    END\\n  $$;", "name": "asset_metadata_audit", "type": "function"}
trigger_asset_metadata_audit	{"sql": "CREATE OR REPLACE TRIGGER \\"asset_metadata_audit\\"\\n  AFTER DELETE ON \\"asset_metadata\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  WHEN (pg_trigger_depth() = 0)\\n  EXECUTE FUNCTION asset_metadata_audit();", "name": "asset_metadata_audit", "type": "trigger"}
trigger_asset_metadata_updated_at	{"sql": "CREATE OR REPLACE TRIGGER \\"asset_metadata_updated_at\\"\\n  BEFORE UPDATE ON \\"asset_metadata\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();", "name": "asset_metadata_updated_at", "type": "trigger"}
index_idx_ocr_search_text	{"sql": "CREATE INDEX \\"idx_ocr_search_text\\" ON \\"ocr_search\\" USING gin (f_unaccent(\\"text\\") gin_trgm_ops);", "name": "idx_ocr_search_text", "type": "index"}
function_album_asset_delete_audit	{"sql": "CREATE OR REPLACE FUNCTION album_asset_delete_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO album_asset_audit (\\"albumId\\", \\"assetId\\")\\n      SELECT \\"albumId\\", \\"assetId\\" FROM OLD\\n      WHERE \\"albumId\\" IN (SELECT \\"id\\" FROM album WHERE \\"id\\" IN (SELECT \\"albumId\\" FROM OLD));\\n      RETURN NULL;\\n    END\\n  $$;", "name": "album_asset_delete_audit", "type": "function"}
function_album_user_delete_audit	{"sql": "CREATE OR REPLACE FUNCTION album_user_delete_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO album_audit (\\"albumId\\", \\"userId\\")\\n      SELECT \\"albumId\\", \\"userId\\"\\n      FROM OLD;\\n\\n      IF pg_trigger_depth() = 1 THEN\\n        INSERT INTO album_user_audit (\\"albumId\\", \\"userId\\")\\n        SELECT \\"albumId\\", \\"userId\\"\\n        FROM OLD;\\n      END IF;\\n\\n      RETURN NULL;\\n    END\\n  $$;", "name": "album_user_delete_audit", "type": "function"}
function_memory_asset_delete_audit	{"sql": "CREATE OR REPLACE FUNCTION memory_asset_delete_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO memory_asset_audit (\\"memoryId\\", \\"assetId\\")\\n      SELECT \\"memoriesId\\", \\"assetId\\" FROM OLD\\n      WHERE \\"memoriesId\\" IN (SELECT \\"id\\" FROM memory WHERE \\"id\\" IN (SELECT \\"memoriesId\\" FROM OLD));\\n      RETURN NULL;\\n    END\\n  $$;", "name": "memory_asset_delete_audit", "type": "function"}
function_asset_edit_insert	{"sql": "CREATE OR REPLACE FUNCTION asset_edit_insert()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      UPDATE asset\\n      SET \\"isEdited\\" = true\\n      FROM inserted_edit\\n      WHERE asset.id = inserted_edit.\\"assetId\\" AND NOT asset.\\"isEdited\\";\\n      RETURN NULL;\\n    END\\n  $$;", "name": "asset_edit_insert", "type": "function"}
trigger_asset_edit_delete	{"sql": "CREATE OR REPLACE TRIGGER \\"asset_edit_delete\\"\\n  AFTER DELETE ON \\"asset_edit\\"\\n  REFERENCING OLD TABLE AS \\"deleted_edit\\"\\n  FOR EACH STATEMENT\\n  WHEN (pg_trigger_depth() = 0)\\n  EXECUTE FUNCTION asset_edit_delete();", "name": "asset_edit_delete", "type": "trigger"}
trigger_asset_edit_insert	{"sql": "CREATE OR REPLACE TRIGGER \\"asset_edit_insert\\"\\n  AFTER INSERT ON \\"asset_edit\\"\\n  REFERENCING NEW TABLE AS \\"inserted_edit\\"\\n  FOR EACH STATEMENT\\n  EXECUTE FUNCTION asset_edit_insert();", "name": "asset_edit_insert", "type": "trigger"}
function_asset_edit_audit	{"sql": "CREATE OR REPLACE FUNCTION asset_edit_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO asset_edit_audit (\\"editId\\", \\"assetId\\")\\n      SELECT \\"id\\", \\"assetId\\"\\n      FROM OLD;\\n      RETURN NULL;\\n    END\\n  $$;", "name": "asset_edit_audit", "type": "function"}
trigger_asset_edit_audit	{"sql": "CREATE OR REPLACE TRIGGER \\"asset_edit_audit\\"\\n  AFTER DELETE ON \\"asset_edit\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  WHEN (pg_trigger_depth() = 0)\\n  EXECUTE FUNCTION asset_edit_audit();", "name": "asset_edit_audit", "type": "trigger"}
trigger_asset_edit_updatedAt	{"sql": "CREATE OR REPLACE TRIGGER \\"asset_edit_updatedAt\\"\\n  BEFORE UPDATE ON \\"asset_edit\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();", "name": "asset_edit_updatedAt", "type": "trigger"}
index_IDX_asset_exif_gist_earthcoord	{"sql": "CREATE INDEX \\"IDX_asset_exif_gist_earthcoord\\" ON \\"asset_exif\\" USING gist (ll_to_earth_public(latitude, longitude));", "name": "IDX_asset_exif_gist_earthcoord", "type": "index"}
index_idx_person_name_trigram	{"sql": "CREATE INDEX \\"idx_person_name_trigram\\" ON \\"person\\" USING gin (f_unaccent(\\"name\\") gin_trgm_ops);", "name": "idx_person_name_trigram", "type": "index"}
trigger_pixelunion_session_token_updatedAt	{"sql": "CREATE OR REPLACE TRIGGER \\"pixelunion_session_token_updatedAt\\"\\n  BEFORE UPDATE ON \\"pixelunion_session_token\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();", "name": "pixelunion_session_token_updatedAt", "type": "trigger"}
index_asset_id_timeline_notDeleted_idx	{"sql": "CREATE INDEX \\"asset_id_timeline_notDeleted_idx\\" ON \\"asset\\" (\\"id\\") WHERE (visibility = 'timeline' AND \\"deletedAt\\" IS NULL);", "name": "asset_id_timeline_notDeleted_idx", "type": "index"}
index_asset_localDateTime_month_idx	{"sql": "CREATE INDEX \\"asset_localDateTime_month_idx\\" ON \\"asset\\" (date_trunc('MONTH'::text, (\\"localDateTime\\" AT TIME ZONE 'UTC'::text)) AT TIME ZONE 'UTC'::text);", "name": "asset_localDateTime_month_idx", "type": "index"}
index_asset_localDateTime_idx	{"sql": "CREATE INDEX \\"asset_localDateTime_idx\\" ON \\"asset\\" ((\\"localDateTime\\" at time zone 'UTC')::date);", "name": "asset_localDateTime_idx", "type": "index"}
index_activity_like_idx	{"sql": "CREATE UNIQUE INDEX \\"activity_like_idx\\" ON \\"activity\\" (\\"assetId\\", \\"userId\\", \\"albumId\\") WHERE ((\\"isLiked\\" = true));", "name": "activity_like_idx", "type": "index"}
function_album_user_after_insert	{"sql": "CREATE OR REPLACE FUNCTION album_user_after_insert()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      UPDATE album SET \\"updatedAt\\" = clock_timestamp(), \\"updateId\\" = immich_uuid_v7(clock_timestamp())\\n      WHERE \\"id\\" IN (SELECT \\"albumId\\" FROM inserted_rows)\\n        AND NOT EXISTS (SELECT FROM inserted_rows WHERE role = 'owner');\\n      RETURN NULL;\\n    END\\n  $$;", "name": "album_user_after_insert", "type": "function"}
index_album_user_unique_owner	{"sql": "CREATE UNIQUE INDEX \\"album_user_unique_owner\\" ON \\"album_user\\" (\\"albumId\\") WHERE (role = 'owner');", "name": "album_user_unique_owner", "type": "index"}
trigger_workflow_updatedAt	{"sql": "CREATE OR REPLACE TRIGGER \\"workflow_updatedAt\\"\\n  BEFORE UPDATE ON \\"workflow\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();", "name": "workflow_updatedAt", "type": "trigger"}
function_asset_ocr_delete_audit	{"sql": "CREATE OR REPLACE FUNCTION asset_ocr_delete_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO asset_ocr_audit (\\"assetId\\")\\n      SELECT \\"assetId\\"\\n      FROM OLD;\\n      RETURN NULL;\\n    END\\n  $$;", "name": "asset_ocr_delete_audit", "type": "function"}
trigger_asset_ocr_delete_audit	{"sql": "CREATE OR REPLACE TRIGGER \\"asset_ocr_delete_audit\\"\\n  AFTER DELETE ON \\"asset_ocr\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  WHEN (pg_trigger_depth() = 0)\\n  EXECUTE FUNCTION asset_ocr_delete_audit();", "name": "asset_ocr_delete_audit", "type": "trigger"}
function_asset_edit_delete	{"sql": "CREATE OR REPLACE FUNCTION asset_edit_delete()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      UPDATE asset\\n      SET \\"isEdited\\" = false\\n      FROM deleted_edit\\n      WHERE asset.id = deleted_edit.\\"assetId\\" AND asset.\\"isEdited\\"\\n        AND NOT EXISTS (SELECT FROM asset_edit edit WHERE edit.\\"assetId\\" = asset.id);\\n      RETURN NULL;\\n    END\\n  $$;", "name": "asset_edit_delete", "type": "function"}
function_album_user_delete	{"sql": "CREATE OR REPLACE FUNCTION album_user_delete()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      DELETE FROM \\"album\\"\\n      WHERE \\"album\\".\\"id\\" = OLD.\\"albumId\\"\\n      AND NOT EXISTS (SELECT \\"albumId\\" FROM \\"album_user\\" WHERE \\"album_user\\".\\"albumId\\" = \\"album\\".\\"id\\" AND \\"album_user\\".\\"role\\" = 'owner');\\n\\n      RETURN NULL;\\n    END\\n  $$;", "name": "album_user_delete", "type": "function"}
trigger_album_user_delete	{"sql": "CREATE OR REPLACE TRIGGER \\"album_user_delete\\"\\n  AFTER DELETE ON \\"album_user\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION album_user_delete();", "name": "album_user_delete", "type": "trigger"}
trigger_asset_ocr_updatedAt	{"sql": "CREATE OR REPLACE TRIGGER \\"asset_ocr_updatedAt\\"\\n  BEFORE UPDATE ON \\"asset_ocr\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();", "name": "asset_ocr_updatedAt", "type": "trigger"}
function_person_delete_audit	{"sql": "CREATE OR REPLACE FUNCTION person_delete_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO person_audit (\\"personGroupId\\", \\"ownerId\\")\\n      SELECT \\"personGroupId\\", \\"ownerId\\"\\n      FROM OLD;\\n      RETURN NULL;\\n    END\\n  $$;", "name": "person_delete_audit", "type": "function"}
trigger_person_delete_audit	{"sql": "CREATE OR REPLACE TRIGGER \\"person_delete_audit\\"\\n  AFTER DELETE ON \\"person\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  WHEN (pg_trigger_depth() <= 1)\\n  EXECUTE FUNCTION person_delete_audit();", "name": "person_delete_audit", "type": "trigger"}
function_person_group_delete_audit	{"sql": "CREATE OR REPLACE FUNCTION person_group_delete_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO person_group_audit (\\"personGroupId\\", \\"clusterGroupId\\")\\n      SELECT \\"id\\", \\"clusterGroupId\\"\\n      FROM OLD;\\n      RETURN NULL;\\n    END\\n  $$;", "name": "person_group_delete_audit", "type": "function"}
trigger_cluster_group_updatedAt	{"sql": "CREATE OR REPLACE TRIGGER \\"cluster_group_updatedAt\\"\\n  BEFORE UPDATE ON \\"cluster_group\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();", "name": "cluster_group_updatedAt", "type": "trigger"}
trigger_person_group_delete_audit	{"sql": "CREATE OR REPLACE TRIGGER \\"person_group_delete_audit\\"\\n  AFTER DELETE ON \\"person_group\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  WHEN (pg_trigger_depth() = 0)\\n  EXECUTE FUNCTION person_group_delete_audit();", "name": "person_group_delete_audit", "type": "trigger"}
trigger_person_group_updatedAt	{"sql": "CREATE OR REPLACE TRIGGER \\"person_group_updatedAt\\"\\n  BEFORE UPDATE ON \\"person_group\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();", "name": "person_group_updatedAt", "type": "trigger"}
index_asset_face_personGroupId_assetId_notDeleted_isVisible_idx	{"sql": "CREATE INDEX \\"asset_face_personGroupId_assetId_notDeleted_isVisible_idx\\" ON \\"asset_face\\" (\\"personGroupId\\", \\"assetId\\") WHERE (\\"deletedAt\\" IS NULL AND \\"isVisible\\" IS TRUE);", "name": "asset_face_personGroupId_assetId_notDeleted_isVisible_idx", "type": "index"}
function_person_delete_shares	{"sql": "CREATE OR REPLACE FUNCTION person_delete_shares()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      DELETE FROM person_user\\n      USING deleted_rows\\n      WHERE person_user.\\"personGroupId\\" = deleted_rows.\\"personGroupId\\"\\n        AND person_user.\\"sharedWithId\\" = deleted_rows.\\"ownerId\\";\\n      RETURN NULL;\\n    END\\n  $$;", "name": "person_delete_shares", "type": "function"}
trigger_person_delete_shares	{"sql": "CREATE OR REPLACE TRIGGER \\"person_delete_shares\\"\\n  AFTER DELETE ON \\"person\\"\\n  REFERENCING OLD TABLE AS \\"deleted_rows\\"\\n  FOR EACH STATEMENT\\n  EXECUTE FUNCTION person_delete_shares();", "name": "person_delete_shares", "type": "trigger"}
trigger_person_user_after_insert	{"sql": "CREATE OR REPLACE TRIGGER \\"person_user_after_insert\\"\\n  AFTER INSERT ON \\"person_user\\"\\n  REFERENCING NEW TABLE AS \\"inserted_rows\\"\\n  FOR EACH STATEMENT\\n  EXECUTE FUNCTION person_user_after_insert();", "name": "person_user_after_insert", "type": "trigger"}
trigger_person_user_updatedAt	{"sql": "CREATE OR REPLACE TRIGGER \\"person_user_updatedAt\\"\\n  BEFORE UPDATE ON \\"person_user\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();", "name": "person_user_updatedAt", "type": "trigger"}
function_person_user_after_insert	{"sql": "CREATE OR REPLACE FUNCTION person_user_after_insert()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO person (\\"ownerId\\", \\"personGroupId\\", \\"name\\", \\"birthDate\\")\\n      SELECT DISTINCT ON (i.\\"sharedWithId\\", i.\\"personGroupId\\")\\n        i.\\"sharedWithId\\", i.\\"personGroupId\\", shared.\\"name\\", shared.\\"birthDate\\"\\n      FROM inserted_rows i\\n      INNER JOIN person shared\\n        ON shared.\\"ownerId\\" = i.\\"sharedById\\" AND shared.\\"personGroupId\\" = i.\\"personGroupId\\"\\n      ORDER BY i.\\"sharedWithId\\", i.\\"personGroupId\\", shared.\\"name\\" = '', shared.\\"birthDate\\" IS NULL\\n      ON CONFLICT (\\"ownerId\\", \\"personGroupId\\") DO UPDATE\\n      SET\\n        \\"name\\" = CASE WHEN person.\\"name\\" = '' THEN EXCLUDED.\\"name\\" ELSE person.\\"name\\" END,\\n        \\"birthDate\\" = COALESCE(person.\\"birthDate\\", EXCLUDED.\\"birthDate\\")\\n      WHERE (person.\\"name\\" = '' AND EXCLUDED.\\"name\\" <> '')\\n        OR (person.\\"birthDate\\" IS NULL AND EXCLUDED.\\"birthDate\\" IS NOT NULL);\\n      RETURN NULL;\\n    END\\n  $$;", "name": "person_user_after_insert", "type": "function"}
trigger_asset_face_updatedAt	{"sql": "CREATE OR REPLACE TRIGGER \\"asset_face_updatedAt\\"\\n  BEFORE UPDATE ON \\"asset_face\\"\\n  FOR EACH ROW\\n  WHEN ((OLD.\\"ownerId\\", OLD.\\"assetVisibility\\", OLD.\\"assetDeletedAt\\") IS NOT DISTINCT FROM (NEW.\\"ownerId\\", NEW.\\"assetVisibility\\", NEW.\\"assetDeletedAt\\"))\\n  EXECUTE FUNCTION updated_at();", "name": "asset_face_updatedAt", "type": "trigger"}
function_asset_face_set_asset_state	{"sql": "CREATE OR REPLACE FUNCTION asset_face_set_asset_state()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      -- FOR SHARE so a concurrent update of the asset cannot leave this face with stale state\\n      SELECT \\"ownerId\\", \\"visibility\\", \\"deletedAt\\"\\n      INTO NEW.\\"ownerId\\", NEW.\\"assetVisibility\\", NEW.\\"assetDeletedAt\\"\\n      FROM asset\\n      WHERE \\"id\\" = NEW.\\"assetId\\"\\n      FOR SHARE;\\n      RETURN NEW;\\n    END\\n  $$;", "name": "asset_face_set_asset_state", "type": "function"}
function_asset_face_update_asset_state	{"sql": "CREATE OR REPLACE FUNCTION asset_face_update_asset_state()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      UPDATE asset_face\\n      SET \\"ownerId\\" = NEW.\\"ownerId\\", \\"assetVisibility\\" = NEW.\\"visibility\\", \\"assetDeletedAt\\" = NEW.\\"deletedAt\\"\\n      WHERE \\"assetId\\" = NEW.\\"id\\";\\n      RETURN NULL;\\n    END\\n  $$;", "name": "asset_face_update_asset_state", "type": "function"}
trigger_asset_face_update_asset_state	{"sql": "CREATE OR REPLACE TRIGGER \\"asset_face_update_asset_state\\"\\n  AFTER UPDATE ON \\"asset\\"\\n  FOR EACH ROW\\n  WHEN ((OLD.\\"ownerId\\", OLD.\\"visibility\\", OLD.\\"deletedAt\\") IS DISTINCT FROM (NEW.\\"ownerId\\", NEW.\\"visibility\\", NEW.\\"deletedAt\\"))\\n  EXECUTE FUNCTION asset_face_update_asset_state();", "name": "asset_face_update_asset_state", "type": "trigger"}
trigger_asset_face_set_asset_state	{"sql": "CREATE OR REPLACE TRIGGER \\"asset_face_set_asset_state\\"\\n  BEFORE INSERT ON \\"asset_face\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION asset_face_set_asset_state();", "name": "asset_face_set_asset_state", "type": "trigger"}
index_asset_face_personGroupId_ownerId_assetId_timeline_idx	{"sql": "CREATE INDEX \\"asset_face_personGroupId_ownerId_assetId_timeline_idx\\" ON \\"asset_face\\" (\\"personGroupId\\", \\"ownerId\\", \\"assetId\\") WHERE (\\"deletedAt\\" IS NULL AND \\"isVisible\\" IS TRUE AND \\"assetVisibility\\" = 'timeline' AND \\"assetDeletedAt\\" IS NULL);", "name": "asset_face_personGroupId_ownerId_assetId_timeline_idx", "type": "index"}
\.


--
-- Data for Name: move_history; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.move_history (id, "entityId", "pathType", "oldPath", "newPath") FROM stdin;
\.


--
-- Data for Name: notification; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.notification (id, "createdAt", "updatedAt", "deletedAt", "updateId", "userId", level, type, data, title, description, "readAt") FROM stdin;
\.


--
-- Data for Name: ocr_search; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ocr_search ("assetId", text) FROM stdin;
\.


--
-- Data for Name: partner; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.partner ("sharedById", "sharedWithId", "createdAt", "updatedAt", "inTimeline", "updateId", "createId") FROM stdin;
\.


--
-- Data for Name: partner_audit; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.partner_audit (id, "sharedById", "sharedWithId", "deletedAt") FROM stdin;
\.


--
-- Data for Name: person; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.person ("createdAt", "updatedAt", "ownerId", name, "thumbnailPath", "isHidden", "birthDate", "faceAssetId", "isFavorite", color, "updateId", "personGroupId") FROM stdin;
\.


--
-- Data for Name: person_audit; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.person_audit (id, "ownerId", "deletedAt", "personGroupId") FROM stdin;
\.


--
-- Data for Name: person_group; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.person_group (id, "clusterGroupId", "createdAt", "createId", "updatedAt", "updateId") FROM stdin;
\.


--
-- Data for Name: person_group_audit; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.person_group_audit (id, "personGroupId", "clusterGroupId", "deletedAt") FROM stdin;
\.


--
-- Data for Name: person_user; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.person_user ("personGroupId", "sharedById", "sharedWithId", role, "createdAt", "updatedAt", "updateId") FROM stdin;
\.


--
-- Data for Name: pixelunion_session_token; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.pixelunion_session_token ("sessionId", "keycloakRefreshToken", "createdAt", "updatedAt", "updateId") FROM stdin;
\.


--
-- Data for Name: session; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.session (id, token, "createdAt", "updatedAt", "userId", "deviceType", "deviceOS", "updateId", "pinExpiresAt", "expiresAt", "parentId", "isPendingSyncReset", "appVersion", "oauthSid", "oauthBearerToken") FROM stdin;
\.


--
-- Data for Name: session_sync_checkpoint; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.session_sync_checkpoint ("sessionId", type, "createdAt", "updatedAt", ack, "updateId") FROM stdin;
\.


--
-- Data for Name: shared_link; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.shared_link (id, description, "userId", key, type, "createdAt", "expiresAt", "allowUpload", "albumId", "allowDownload", "showExif", password, slug) FROM stdin;
\.


--
-- Data for Name: shared_link_asset; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.shared_link_asset ("assetId", "sharedLinkId") FROM stdin;
\.


--
-- Data for Name: smart_search; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.smart_search ("assetId", embedding) FROM stdin;
\.


--
-- Data for Name: stack; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.stack (id, "primaryAssetId", "ownerId", "createdAt", "updatedAt", "updateId") FROM stdin;
\.


--
-- Data for Name: stack_audit; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.stack_audit (id, "stackId", "userId", "deletedAt") FROM stdin;
\.


--
-- Data for Name: system_metadata; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.system_metadata (key, value) FROM stdin;
system-flags	{"mountChecks": {"thumbs": true, "upload": true, "backups": true, "library": true, "profile": true, "encoded-video": true}}
MediaLocation	{"location": "/data"}
reverse-geocoding-state	{"lastUpdate": "2026-10-21T16:09:14+00:00", "lastImportFileName": "cities500.txt"}
admin-onboarding	{"isOnboarded": true}
\.


--
-- Data for Name: tag; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tag (id, "userId", value, "createdAt", "updatedAt", color, "parentId", "updateId") FROM stdin;
\.


--
-- Data for Name: tag_asset; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tag_asset ("assetId", "tagId") FROM stdin;
\.


--
-- Data for Name: tag_closure; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tag_closure (id_ancestor, id_descendant) FROM stdin;
\.


--
-- Data for Name: user; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."user" (id, email, password, "createdAt", "profileImagePath", "isAdmin", "shouldChangePassword", "deletedAt", "oauthId", "updatedAt", "storageLabel", name, "quotaSizeInBytes", "quotaUsageInBytes", status, "profileChangedAt", "updateId", "avatarColor", "pinCode", "clusterGroupId") FROM stdin;
\.


--
-- Data for Name: user_audit; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_audit ("userId", "deletedAt", id) FROM stdin;
\.


--
-- Data for Name: user_metadata; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_metadata ("userId", key, value, "updateId", "updatedAt") FROM stdin;
\.


--
-- Data for Name: user_metadata_audit; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_metadata_audit (id, "userId", key, "deletedAt") FROM stdin;
\.


--
-- Data for Name: version_history; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.version_history (id, "createdAt", version) FROM stdin;
c48d0f4d-6e2d-44f0-89f1-97f208283096	2026-11-27 14:59:43.26434+00	3.3.5
\.


--
-- Data for Name: video_stream_segment; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.video_stream_segment ("variantId", index, "durationUs") FROM stdin;
\.


--
-- Data for Name: video_stream_session; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.video_stream_session (id, "assetId", "expiresAt", "createdAt") FROM stdin;
\.


--
-- Data for Name: video_stream_variant; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.video_stream_variant (id, "sessionId", "createdAt", bitrate, codec, resolution) FROM stdin;
\.


--
-- Name: naturalearth_countries_tmp_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.naturalearth_countries_tmp_id_seq', 4274, true);


--
-- Name: move_history UQ_entityId_pathType; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.move_history
    ADD CONSTRAINT "UQ_entityId_pathType" UNIQUE ("entityId", "pathType");


--
-- Name: move_history UQ_newPath; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.move_history
    ADD CONSTRAINT "UQ_newPath" UNIQUE ("newPath");


--
-- Name: activity activity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity
    ADD CONSTRAINT activity_pkey PRIMARY KEY (id);


--
-- Name: album_asset_audit album_asset_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.album_asset_audit
    ADD CONSTRAINT album_asset_audit_pkey PRIMARY KEY (id);


--
-- Name: album_asset album_asset_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.album_asset
    ADD CONSTRAINT album_asset_pkey PRIMARY KEY ("albumId", "assetId");


--
-- Name: album_audit album_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.album_audit
    ADD CONSTRAINT album_audit_pkey PRIMARY KEY (id);


--
-- Name: album album_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.album
    ADD CONSTRAINT album_pkey PRIMARY KEY (id);


--
-- Name: album_user_audit album_user_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.album_user_audit
    ADD CONSTRAINT album_user_audit_pkey PRIMARY KEY (id);


--
-- Name: album_user album_user_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.album_user
    ADD CONSTRAINT album_user_pkey PRIMARY KEY ("albumId", "userId");


--
-- Name: api_key api_key_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_key
    ADD CONSTRAINT api_key_pkey PRIMARY KEY (id);


--
-- Name: asset_audio asset_audio_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_audio
    ADD CONSTRAINT asset_audio_pkey PRIMARY KEY ("assetId");


--
-- Name: asset_audit asset_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_audit
    ADD CONSTRAINT asset_audit_pkey PRIMARY KEY (id);


--
-- Name: asset_edit asset_edit_assetId_sequence_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_edit
    ADD CONSTRAINT "asset_edit_assetId_sequence_uq" UNIQUE ("assetId", sequence);


--
-- Name: asset_edit_audit asset_edit_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_edit_audit
    ADD CONSTRAINT asset_edit_audit_pkey PRIMARY KEY (id);


--
-- Name: asset_edit asset_edit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_edit
    ADD CONSTRAINT asset_edit_pkey PRIMARY KEY (id);


--
-- Name: asset_exif asset_exif_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_exif
    ADD CONSTRAINT asset_exif_pkey PRIMARY KEY ("assetId");


--
-- Name: asset_face_audit asset_face_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_face_audit
    ADD CONSTRAINT asset_face_audit_pkey PRIMARY KEY (id);


--
-- Name: asset_face asset_face_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_face
    ADD CONSTRAINT asset_face_pkey PRIMARY KEY (id);


--
-- Name: asset_file asset_file_assetId_type_isEdited_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_file
    ADD CONSTRAINT "asset_file_assetId_type_isEdited_uq" UNIQUE ("assetId", type, "isEdited");


--
-- Name: asset_file asset_file_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_file
    ADD CONSTRAINT asset_file_pkey PRIMARY KEY (id);


--
-- Name: asset_job_status asset_job_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_job_status
    ADD CONSTRAINT asset_job_status_pkey PRIMARY KEY ("assetId");


--
-- Name: asset_keyframe asset_keyframe_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_keyframe
    ADD CONSTRAINT asset_keyframe_pkey PRIMARY KEY ("assetId");


--
-- Name: asset_metadata_audit asset_metadata_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_metadata_audit
    ADD CONSTRAINT asset_metadata_audit_pkey PRIMARY KEY (id);


--
-- Name: asset_metadata asset_metadata_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_metadata
    ADD CONSTRAINT asset_metadata_pkey PRIMARY KEY ("assetId", key);


--
-- Name: asset_ocr_audit asset_ocr_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_ocr_audit
    ADD CONSTRAINT asset_ocr_audit_pkey PRIMARY KEY (id);


--
-- Name: asset_ocr asset_ocr_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_ocr
    ADD CONSTRAINT asset_ocr_pkey PRIMARY KEY (id);


--
-- Name: asset asset_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset
    ADD CONSTRAINT asset_pkey PRIMARY KEY (id);


--
-- Name: asset_video asset_video_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_video
    ADD CONSTRAINT asset_video_pkey PRIMARY KEY ("assetId");


--
-- Name: cluster_group cluster_group_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cluster_group
    ADD CONSTRAINT cluster_group_pkey PRIMARY KEY (id);


--
-- Name: cluster_group_request cluster_group_request_clusterGroupId_userId_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cluster_group_request
    ADD CONSTRAINT "cluster_group_request_clusterGroupId_userId_uq" UNIQUE ("clusterGroupId", "userId");


--
-- Name: cluster_group_request cluster_group_request_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cluster_group_request
    ADD CONSTRAINT cluster_group_request_pkey PRIMARY KEY (id);


--
-- Name: face_search face_search_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.face_search
    ADD CONSTRAINT face_search_pkey PRIMARY KEY ("faceId");


--
-- Name: geodata_places geodata_places_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geodata_places
    ADD CONSTRAINT geodata_places_pkey PRIMARY KEY (id) WITH (fillfactor='100');


--
-- Name: integrity_report integrity_report_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integrity_report
    ADD CONSTRAINT integrity_report_pkey PRIMARY KEY (id);


--
-- Name: integrity_report integrity_report_type_path_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integrity_report
    ADD CONSTRAINT integrity_report_type_path_uq UNIQUE (type, path);


--
-- Name: kysely_migrations_lock kysely_migrations_lock_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kysely_migrations_lock
    ADD CONSTRAINT kysely_migrations_lock_pkey PRIMARY KEY (id);


--
-- Name: kysely_migrations kysely_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kysely_migrations
    ADD CONSTRAINT kysely_migrations_pkey PRIMARY KEY (name);


--
-- Name: library library_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library
    ADD CONSTRAINT library_pkey PRIMARY KEY (id);


--
-- Name: memory_asset_audit memory_asset_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_asset_audit
    ADD CONSTRAINT memory_asset_audit_pkey PRIMARY KEY (id);


--
-- Name: memory_asset memory_asset_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_asset
    ADD CONSTRAINT memory_asset_pkey PRIMARY KEY ("memoriesId", "assetId");


--
-- Name: memory_audit memory_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_audit
    ADD CONSTRAINT memory_audit_pkey PRIMARY KEY (id);


--
-- Name: memory memory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory
    ADD CONSTRAINT memory_pkey PRIMARY KEY (id);


--
-- Name: migration_overrides migration_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migration_overrides
    ADD CONSTRAINT migration_overrides_pkey PRIMARY KEY (name);


--
-- Name: move_history move_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.move_history
    ADD CONSTRAINT move_history_pkey PRIMARY KEY (id);


--
-- Name: naturalearth_countries naturalearth_countries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.naturalearth_countries
    ADD CONSTRAINT naturalearth_countries_pkey PRIMARY KEY (id) WITH (fillfactor='100');


--
-- Name: notification notification_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification
    ADD CONSTRAINT notification_pkey PRIMARY KEY (id);


--
-- Name: ocr_search ocr_search_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocr_search
    ADD CONSTRAINT ocr_search_pkey PRIMARY KEY ("assetId");


--
-- Name: partner_audit partner_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_audit
    ADD CONSTRAINT partner_audit_pkey PRIMARY KEY (id);


--
-- Name: partner partner_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner
    ADD CONSTRAINT partner_pkey PRIMARY KEY ("sharedById", "sharedWithId");


--
-- Name: person_audit person_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.person_audit
    ADD CONSTRAINT person_audit_pkey PRIMARY KEY (id);


--
-- Name: person_group_audit person_group_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.person_group_audit
    ADD CONSTRAINT person_group_audit_pkey PRIMARY KEY (id);


--
-- Name: person_group person_group_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.person_group
    ADD CONSTRAINT person_group_pkey PRIMARY KEY (id);


--
-- Name: person person_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.person
    ADD CONSTRAINT person_pkey PRIMARY KEY ("ownerId", "personGroupId");


--
-- Name: person_user person_user_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.person_user
    ADD CONSTRAINT person_user_pkey PRIMARY KEY ("personGroupId", "sharedById", "sharedWithId");


--
-- Name: pixelunion_session_token pixelunion_session_token_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pixelunion_session_token
    ADD CONSTRAINT pixelunion_session_token_pkey PRIMARY KEY ("sessionId");


--
-- Name: plugin_method plugin_method_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_method
    ADD CONSTRAINT plugin_method_pkey PRIMARY KEY (id);


--
-- Name: plugin_method plugin_method_pluginId_name_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_method
    ADD CONSTRAINT "plugin_method_pluginId_name_uq" UNIQUE ("pluginId", name);


--
-- Name: plugin plugin_name_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin
    ADD CONSTRAINT plugin_name_uq UNIQUE (name);


--
-- Name: plugin plugin_name_version_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin
    ADD CONSTRAINT plugin_name_version_uq UNIQUE (name, version);


--
-- Name: plugin plugin_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin
    ADD CONSTRAINT plugin_pkey PRIMARY KEY (id);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (id);


--
-- Name: session_sync_checkpoint session_sync_checkpoint_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_sync_checkpoint
    ADD CONSTRAINT session_sync_checkpoint_pkey PRIMARY KEY ("sessionId", type);


--
-- Name: shared_link_asset shared_link_asset_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_link_asset
    ADD CONSTRAINT shared_link_asset_pkey PRIMARY KEY ("assetId", "sharedLinkId");


--
-- Name: shared_link shared_link_key_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_link
    ADD CONSTRAINT shared_link_key_uq UNIQUE (key);


--
-- Name: shared_link shared_link_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_link
    ADD CONSTRAINT shared_link_pkey PRIMARY KEY (id);


--
-- Name: shared_link shared_link_slug_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_link
    ADD CONSTRAINT shared_link_slug_uq UNIQUE (slug);


--
-- Name: smart_search smart_search_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.smart_search
    ADD CONSTRAINT smart_search_pkey PRIMARY KEY ("assetId");


--
-- Name: stack_audit stack_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stack_audit
    ADD CONSTRAINT stack_audit_pkey PRIMARY KEY (id);


--
-- Name: stack stack_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stack
    ADD CONSTRAINT stack_pkey PRIMARY KEY (id);


--
-- Name: stack stack_primaryAssetId_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stack
    ADD CONSTRAINT "stack_primaryAssetId_uq" UNIQUE ("primaryAssetId");


--
-- Name: system_metadata system_metadata_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_metadata
    ADD CONSTRAINT system_metadata_pkey PRIMARY KEY (key);


--
-- Name: tag_asset tag_asset_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_asset
    ADD CONSTRAINT tag_asset_pkey PRIMARY KEY ("assetId", "tagId");


--
-- Name: tag_closure tag_closure_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_closure
    ADD CONSTRAINT tag_closure_pkey PRIMARY KEY (id_ancestor, id_descendant);


--
-- Name: tag tag_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag
    ADD CONSTRAINT tag_pkey PRIMARY KEY (id);


--
-- Name: tag tag_userId_value_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag
    ADD CONSTRAINT "tag_userId_value_uq" UNIQUE ("userId", value);


--
-- Name: user_audit user_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_audit
    ADD CONSTRAINT user_audit_pkey PRIMARY KEY (id);


--
-- Name: user user_email_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_email_uq UNIQUE (email);


--
-- Name: user_metadata_audit user_metadata_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_metadata_audit
    ADD CONSTRAINT user_metadata_audit_pkey PRIMARY KEY (id);


--
-- Name: user_metadata user_metadata_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_metadata
    ADD CONSTRAINT user_metadata_pkey PRIMARY KEY ("userId", key);


--
-- Name: user user_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);


--
-- Name: user user_storageLabel_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT "user_storageLabel_uq" UNIQUE ("storageLabel");


--
-- Name: version_history version_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.version_history
    ADD CONSTRAINT version_history_pkey PRIMARY KEY (id);


--
-- Name: video_stream_segment video_stream_segment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_stream_segment
    ADD CONSTRAINT video_stream_segment_pkey PRIMARY KEY ("variantId", index);


--
-- Name: video_stream_session video_stream_session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_stream_session
    ADD CONSTRAINT video_stream_session_pkey PRIMARY KEY (id);


--
-- Name: video_stream_variant video_stream_variant_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_stream_variant
    ADD CONSTRAINT video_stream_variant_pkey PRIMARY KEY (id);


--
-- Name: workflow_log workflow_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_log
    ADD CONSTRAINT workflow_log_pkey PRIMARY KEY (id);


--
-- Name: workflow workflow_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow
    ADD CONSTRAINT workflow_pkey PRIMARY KEY (id);


--
-- Name: workflow_step workflow_step_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_step
    ADD CONSTRAINT workflow_step_pkey PRIMARY KEY (id);


--
-- Name: IDX_asset_exif_gist_earthcoord; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_asset_exif_gist_earthcoord" ON public.asset_exif USING gist (public.ll_to_earth_public(latitude, longitude));


--
-- Name: IDX_geodata_gist_earthcoord; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_geodata_gist_earthcoord" ON public.geodata_places USING gist (public.ll_to_earth_public(latitude, longitude));


--
-- Name: IDX_pixelunion_session_token_update_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_pixelunion_session_token_update_id" ON public.pixelunion_session_token USING btree ("updateId");


--
-- Name: IDX_user_metadata_audit_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_user_metadata_audit_deleted_at" ON public.user_metadata_audit USING btree ("deletedAt");


--
-- Name: IDX_user_metadata_audit_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_user_metadata_audit_key" ON public.user_metadata_audit USING btree (key);


--
-- Name: IDX_user_metadata_audit_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_user_metadata_audit_user_id" ON public.user_metadata_audit USING btree ("userId");


--
-- Name: IDX_user_metadata_update_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_user_metadata_update_id" ON public.user_metadata USING btree ("updateId");


--
-- Name: IDX_user_metadata_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_user_metadata_updated_at" ON public.user_metadata USING btree ("updatedAt");


--
-- Name: UQ_assets_owner_checksum; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "UQ_assets_owner_checksum" ON public.asset USING btree ("ownerId", checksum) WHERE ("libraryId" IS NULL);


--
-- Name: activity_albumId_assetId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "activity_albumId_assetId_idx" ON public.activity USING btree ("albumId", "assetId");


--
-- Name: activity_albumId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "activity_albumId_idx" ON public.activity USING btree ("albumId");


--
-- Name: activity_assetId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "activity_assetId_idx" ON public.activity USING btree ("assetId");


--
-- Name: activity_like_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX activity_like_idx ON public.activity USING btree ("assetId", "userId", "albumId") WHERE ("isLiked" = true);


--
-- Name: activity_updateId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "activity_updateId_idx" ON public.activity USING btree ("updateId");


--
-- Name: activity_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "activity_userId_idx" ON public.activity USING btree ("userId");


--
-- Name: album_albumThumbnailAssetId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "album_albumThumbnailAssetId_idx" ON public.album USING btree ("albumThumbnailAssetId");


--
-- Name: album_asset_albumId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "album_asset_albumId_idx" ON public.album_asset USING btree ("albumId");


--
-- Name: album_asset_assetId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "album_asset_assetId_idx" ON public.album_asset USING btree ("assetId");


--
-- Name: album_asset_audit_albumId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "album_asset_audit_albumId_idx" ON public.album_asset_audit USING btree ("albumId");


--
-- Name: album_asset_audit_assetId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "album_asset_audit_assetId_idx" ON public.album_asset_audit USING btree ("assetId");


--
-- Name: album_asset_audit_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "album_asset_audit_deletedAt_idx" ON public.album_asset_audit USING btree ("deletedAt");


--
-- Name: album_asset_updateId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "album_asset_updateId_idx" ON public.album_asset USING btree ("updateId");


--
-- Name: album_audit_albumId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "album_audit_albumId_idx" ON public.album_audit USING btree ("albumId");


--
-- Name: album_audit_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "album_audit_deletedAt_idx" ON public.album_audit USING btree ("deletedAt");


--
-- Name: album_audit_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "album_audit_userId_idx" ON public.album_audit USING btree ("userId");


--
-- Name: album_updateId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "album_updateId_idx" ON public.album USING btree ("updateId");


--
-- Name: album_user_albumId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "album_user_albumId_idx" ON public.album_user USING btree ("albumId");


--
-- Name: album_user_audit_albumId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "album_user_audit_albumId_idx" ON public.album_user_audit USING btree ("albumId");


--
-- Name: album_user_audit_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "album_user_audit_deletedAt_idx" ON public.album_user_audit USING btree ("deletedAt");


--
-- Name: album_user_audit_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "album_user_audit_userId_idx" ON public.album_user_audit USING btree ("userId");


--
-- Name: album_user_createId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "album_user_createId_idx" ON public.album_user USING btree ("createId");


--
-- Name: album_user_unique_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX album_user_unique_owner ON public.album_user USING btree ("albumId") WHERE (role = 'owner'::public.album_user_role_enum);


--
-- Name: album_user_updateId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "album_user_updateId_idx" ON public.album_user USING btree ("updateId");


--
-- Name: album_user_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "album_user_userId_idx" ON public.album_user USING btree ("userId");


--
-- Name: api_key_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX api_key_key_idx ON public.api_key USING btree (key);


--
-- Name: api_key_updateId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "api_key_updateId_idx" ON public.api_key USING btree ("updateId");


--
-- Name: api_key_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "api_key_userId_idx" ON public.api_key USING btree ("userId");


--
-- Name: asset_audit_assetId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_audit_assetId_idx" ON public.asset_audit USING btree ("assetId");


--
-- Name: asset_audit_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_audit_deletedAt_idx" ON public.asset_audit USING btree ("deletedAt");


--
-- Name: asset_audit_ownerId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_audit_ownerId_idx" ON public.asset_audit USING btree ("ownerId");


--
-- Name: asset_checksum_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_checksum_idx ON public.asset USING btree (checksum);


--
-- Name: asset_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_createdAt_idx" ON public.asset USING btree ("createdAt");


--
-- Name: asset_duplicateId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_duplicateId_idx" ON public.asset USING btree ("duplicateId");


--
-- Name: asset_edit_assetId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_edit_assetId_idx" ON public.asset_edit USING btree ("assetId");


--
-- Name: asset_edit_audit_assetId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_edit_audit_assetId_idx" ON public.asset_edit_audit USING btree ("assetId");


--
-- Name: asset_edit_audit_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_edit_audit_deletedAt_idx" ON public.asset_edit_audit USING btree ("deletedAt");


--
-- Name: asset_edit_updateId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_edit_updateId_idx" ON public.asset_edit USING btree ("updateId");


--
-- Name: asset_exif_autoStackId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_exif_autoStackId_idx" ON public.asset_exif USING btree ("autoStackId");


--
-- Name: asset_exif_city_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_exif_city_idx ON public.asset_exif USING btree (city);


--
-- Name: asset_exif_livePhotoCID_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_exif_livePhotoCID_idx" ON public.asset_exif USING btree ("livePhotoCID");


--
-- Name: asset_exif_updateId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_exif_updateId_idx" ON public.asset_exif USING btree ("updateId");


--
-- Name: asset_face_assetId_personGroupId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_face_assetId_personGroupId_idx" ON public.asset_face USING btree ("assetId", "personGroupId");


--
-- Name: asset_face_audit_assetFaceId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_face_audit_assetFaceId_idx" ON public.asset_face_audit USING btree ("assetFaceId");


--
-- Name: asset_face_audit_assetId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_face_audit_assetId_idx" ON public.asset_face_audit USING btree ("assetId");


--
-- Name: asset_face_audit_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_face_audit_deletedAt_idx" ON public.asset_face_audit USING btree ("deletedAt");


--
-- Name: asset_face_personGroupId_assetId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_face_personGroupId_assetId_idx" ON public.asset_face USING btree ("personGroupId", "assetId");


--
-- Name: asset_face_personGroupId_assetId_notDeleted_isVisible_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_face_personGroupId_assetId_notDeleted_isVisible_idx" ON public.asset_face USING btree ("personGroupId", "assetId") WHERE (("deletedAt" IS NULL) AND ("isVisible" IS TRUE));


--
-- Name: asset_face_personGroupId_ownerId_assetId_timeline_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_face_personGroupId_ownerId_assetId_timeline_idx" ON public.asset_face USING btree ("personGroupId", "ownerId", "assetId") WHERE (("deletedAt" IS NULL) AND ("isVisible" IS TRUE) AND ("assetVisibility" = 'timeline'::public.asset_visibility_enum) AND ("assetDeletedAt" IS NULL));


--
-- Name: asset_fileCreatedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_fileCreatedAt_idx" ON public.asset USING btree ("fileCreatedAt");


--
-- Name: asset_file_assetId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_file_assetId_idx" ON public.asset_file USING btree ("assetId");


--
-- Name: asset_file_updateId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_file_updateId_idx" ON public.asset_file USING btree ("updateId");


--
-- Name: asset_id_stackId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_id_stackId_idx" ON public.asset USING btree (id, "stackId");


--
-- Name: asset_id_timeline_notDeleted_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_id_timeline_notDeleted_idx" ON public.asset USING btree (id) WHERE ((visibility = 'timeline'::public.asset_visibility_enum) AND ("deletedAt" IS NULL));


--
-- Name: asset_libraryId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_libraryId_idx" ON public.asset USING btree ("libraryId");


--
-- Name: asset_livePhotoVideoId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_livePhotoVideoId_idx" ON public.asset USING btree ("livePhotoVideoId");


--
-- Name: asset_localDateTime_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_localDateTime_idx" ON public.asset USING btree (((("localDateTime" AT TIME ZONE 'UTC'::text))::date));


--
-- Name: asset_localDateTime_month_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_localDateTime_month_idx" ON public.asset USING btree ((date_trunc('MONTH'::text, ("localDateTime" AT TIME ZONE 'UTC'::text)) AT TIME ZONE 'UTC'::text));


--
-- Name: asset_metadata_audit_assetId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_metadata_audit_assetId_idx" ON public.asset_metadata_audit USING btree ("assetId");


--
-- Name: asset_metadata_audit_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_metadata_audit_deletedAt_idx" ON public.asset_metadata_audit USING btree ("deletedAt");


--
-- Name: asset_metadata_audit_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_metadata_audit_key_idx ON public.asset_metadata_audit USING btree (key);


--
-- Name: asset_metadata_updateId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_metadata_updateId_idx" ON public.asset_metadata USING btree ("updateId");


--
-- Name: asset_metadata_updatedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_metadata_updatedAt_idx" ON public.asset_metadata USING btree ("updatedAt");


--
-- Name: asset_ocr_assetId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_ocr_assetId_idx" ON public.asset_ocr USING btree ("assetId");


--
-- Name: asset_ocr_audit_assetId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_ocr_audit_assetId_idx" ON public.asset_ocr_audit USING btree ("assetId");


--
-- Name: asset_ocr_audit_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_ocr_audit_deletedAt_idx" ON public.asset_ocr_audit USING btree ("deletedAt");


--
-- Name: asset_ocr_updateId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_ocr_updateId_idx" ON public.asset_ocr USING btree ("updateId");


--
-- Name: asset_originalFileName_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_originalFileName_idx" ON public.asset USING btree ("originalFileName");


--
-- Name: asset_originalFilename_trigram_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_originalFilename_trigram_idx" ON public.asset USING gin (public.f_unaccent(("originalFileName")::text) public.gin_trgm_ops);


--
-- Name: asset_originalPath_libraryId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_originalPath_libraryId_idx" ON public.asset USING btree ("originalPath", "libraryId");


--
-- Name: asset_ownerId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_ownerId_idx" ON public.asset USING btree ("ownerId");


--
-- Name: asset_ownerId_libraryId_checksum_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "asset_ownerId_libraryId_checksum_idx" ON public.asset USING btree ("ownerId", "libraryId", checksum) WHERE ("libraryId" IS NOT NULL);


--
-- Name: asset_stackId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_stackId_idx" ON public.asset USING btree ("stackId");


--
-- Name: asset_updateId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asset_updateId_idx" ON public.asset USING btree ("updateId");


--
-- Name: clip_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clip_index ON public.smart_search USING vchordrq (embedding public.vector_cosine_ops) WITH (options='
        residual_quantization = false
        [build.internal]
        lists = [1]
        spherical_centroids = true
        build_threads = 4
        sampling_factor = 1024
        ');


--
-- Name: cluster_group_request_clusterGroupId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "cluster_group_request_clusterGroupId_idx" ON public.cluster_group_request USING btree ("clusterGroupId");


--
-- Name: cluster_group_request_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "cluster_group_request_userId_idx" ON public.cluster_group_request USING btree ("userId");


--
-- Name: cluster_group_updateId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "cluster_group_updateId_idx" ON public.cluster_group USING btree ("updateId");


--
-- Name: face_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX face_index ON public.face_search USING vchordrq (embedding public.vector_cosine_ops) WITH (options='
        residual_quantization = false
        [build.internal]
        lists = [1]
        spherical_centroids = true
        build_threads = 4
        sampling_factor = 1024
        ');


--
-- Name: idx_geodata_places_admin1_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_geodata_places_admin1_name ON public.geodata_places USING gin (public.f_unaccent(("admin1Name")::text) public.gin_trgm_ops);


--
-- Name: idx_geodata_places_admin2_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_geodata_places_admin2_name ON public.geodata_places USING gin (public.f_unaccent(("admin2Name")::text) public.gin_trgm_ops);


--
-- Name: idx_geodata_places_alternate_names; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_geodata_places_alternate_names ON public.geodata_places USING gin (public.f_unaccent(("alternateNames")::text) public.gin_trgm_ops);


--
-- Name: idx_geodata_places_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_geodata_places_name ON public.geodata_places USING gin (public.f_unaccent((name)::text) public.gin_trgm_ops);


--
-- Name: idx_ocr_search_text; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ocr_search_text ON public.ocr_search USING gin (public.f_unaccent(text) public.gin_trgm_ops);


--
-- Name: idx_person_name_trigram; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_person_name_trigram ON public.person USING gin (public.f_unaccent((name)::text) public.gin_trgm_ops);


--
-- Name: integrity_report_assetId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "integrity_report_assetId_idx" ON public.integrity_report USING btree ("assetId");


--
-- Name: integrity_report_fileAssetId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "integrity_report_fileAssetId_idx" ON public.integrity_report USING btree ("fileAssetId");


--
-- Name: library_ownerId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "library_ownerId_idx" ON public.library USING btree ("ownerId");


--
-- Name: library_updateId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "library_updateId_idx" ON public.library USING btree ("updateId");


--
-- Name: memory_asset_assetId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "memory_asset_assetId_idx" ON public.memory_asset USING btree ("assetId");


--
-- Name: memory_asset_audit_assetId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "memory_asset_audit_assetId_idx" ON public.memory_asset_audit USING btree ("assetId");


--
-- Name: memory_asset_audit_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "memory_asset_audit_deletedAt_idx" ON public.memory_asset_audit USING btree ("deletedAt");


--
-- Name: memory_asset_audit_memoryId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "memory_asset_audit_memoryId_idx" ON public.memory_asset_audit USING btree ("memoryId");


--
-- Name: memory_asset_memoriesId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "memory_asset_memoriesId_idx" ON public.memory_asset USING btree ("memoriesId");


--
-- Name: memory_asset_updateId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "memory_asset_updateId_idx" ON public.memory_asset USING btree ("updateId");


--
-- Name: memory_audit_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "memory_audit_deletedAt_idx" ON public.memory_audit USING btree ("deletedAt");


--
-- Name: memory_audit_memoryId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "memory_audit_memoryId_idx" ON public.memory_audit USING btree ("memoryId");


--
-- Name: memory_audit_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "memory_audit_userId_idx" ON public.memory_audit USING btree ("userId");


--
-- Name: memory_ownerId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "memory_ownerId_idx" ON public.memory USING btree ("ownerId");


--
-- Name: memory_updateId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "memory_updateId_idx" ON public.memory USING btree ("updateId");


--
-- Name: notification_updateId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "notification_updateId_idx" ON public.notification USING btree ("updateId");


--
-- Name: notification_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "notification_userId_idx" ON public.notification USING btree ("userId");


--
-- Name: partner_audit_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "partner_audit_deletedAt_idx" ON public.partner_audit USING btree ("deletedAt");


--
-- Name: partner_audit_sharedById_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "partner_audit_sharedById_idx" ON public.partner_audit USING btree ("sharedById");


--
-- Name: partner_audit_sharedWithId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "partner_audit_sharedWithId_idx" ON public.partner_audit USING btree ("sharedWithId");


--
-- Name: partner_createId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "partner_createId_idx" ON public.partner USING btree ("createId");


--
-- Name: partner_sharedWithId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "partner_sharedWithId_idx" ON public.partner USING btree ("sharedWithId");


--
-- Name: partner_updateId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "partner_updateId_idx" ON public.partner USING btree ("updateId");


--
-- Name: person_audit_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "person_audit_deletedAt_idx" ON public.person_audit USING btree ("deletedAt");


--
-- Name: person_audit_ownerId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "person_audit_ownerId_idx" ON public.person_audit USING btree ("ownerId");


--
-- Name: person_audit_personGroupId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "person_audit_personGroupId_idx" ON public.person_audit USING btree ("personGroupId");


--
-- Name: person_faceAssetId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "person_faceAssetId_idx" ON public.person USING btree ("faceAssetId");


--
-- Name: person_group_audit_clusterGroupId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "person_group_audit_clusterGroupId_idx" ON public.person_group_audit USING btree ("clusterGroupId");


--
-- Name: person_group_audit_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "person_group_audit_deletedAt_idx" ON public.person_group_audit USING btree ("deletedAt");


--
-- Name: person_group_audit_personGroupId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "person_group_audit_personGroupId_idx" ON public.person_group_audit USING btree ("personGroupId");


--
-- Name: person_group_clusterGroupId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "person_group_clusterGroupId_idx" ON public.person_group USING btree ("clusterGroupId");


--
-- Name: person_group_createId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "person_group_createId_idx" ON public.person_group USING btree ("createId");


--
-- Name: person_group_updateId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "person_group_updateId_idx" ON public.person_group USING btree ("updateId");


--
-- Name: person_personGroupId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "person_personGroupId_idx" ON public.person USING btree ("personGroupId");


--
-- Name: person_updateId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "person_updateId_idx" ON public.person USING btree ("updateId");


--
-- Name: person_user_sharedById_personGroupId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "person_user_sharedById_personGroupId_idx" ON public.person_user USING btree ("sharedById", "personGroupId");


--
-- Name: person_user_sharedWithId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "person_user_sharedWithId_idx" ON public.person_user USING btree ("sharedWithId");


--
-- Name: person_user_updateId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "person_user_updateId_idx" ON public.person_user USING btree ("updateId");


--
-- Name: plugin_method_pluginId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "plugin_method_pluginId_idx" ON public.plugin_method USING btree ("pluginId");


--
-- Name: plugin_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX plugin_name_idx ON public.plugin USING btree (name);


--
-- Name: session_oauthSid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "session_oauthSid_idx" ON public.session USING btree ("oauthSid");


--
-- Name: session_parentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "session_parentId_idx" ON public.session USING btree ("parentId");


--
-- Name: session_sync_checkpoint_sessionId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "session_sync_checkpoint_sessionId_idx" ON public.session_sync_checkpoint USING btree ("sessionId");


--
-- Name: session_sync_checkpoint_updateId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "session_sync_checkpoint_updateId_idx" ON public.session_sync_checkpoint USING btree ("updateId");


--
-- Name: session_token_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX session_token_idx ON public.session USING btree (token);


--
-- Name: session_updateId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "session_updateId_idx" ON public.session USING btree ("updateId");


--
-- Name: session_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "session_userId_idx" ON public.session USING btree ("userId");


--
-- Name: shared_link_albumId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "shared_link_albumId_idx" ON public.shared_link USING btree ("albumId");


--
-- Name: shared_link_asset_assetId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "shared_link_asset_assetId_idx" ON public.shared_link_asset USING btree ("assetId");


--
-- Name: shared_link_asset_sharedLinkId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "shared_link_asset_sharedLinkId_idx" ON public.shared_link_asset USING btree ("sharedLinkId");


--
-- Name: shared_link_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX shared_link_key_idx ON public.shared_link USING btree (key);


--
-- Name: shared_link_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "shared_link_userId_idx" ON public.shared_link USING btree ("userId");


--
-- Name: stack_audit_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "stack_audit_deletedAt_idx" ON public.stack_audit USING btree ("deletedAt");


--
-- Name: stack_ownerId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "stack_ownerId_idx" ON public.stack USING btree ("ownerId");


--
-- Name: stack_primaryAssetId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "stack_primaryAssetId_idx" ON public.stack USING btree ("primaryAssetId");


--
-- Name: tag_asset_assetId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "tag_asset_assetId_idx" ON public.tag_asset USING btree ("assetId");


--
-- Name: tag_asset_assetId_tagId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "tag_asset_assetId_tagId_idx" ON public.tag_asset USING btree ("assetId", "tagId");


--
-- Name: tag_asset_tagId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "tag_asset_tagId_idx" ON public.tag_asset USING btree ("tagId");


--
-- Name: tag_closure_id_ancestor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tag_closure_id_ancestor_idx ON public.tag_closure USING btree (id_ancestor);


--
-- Name: tag_closure_id_descendant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tag_closure_id_descendant_idx ON public.tag_closure USING btree (id_descendant);


--
-- Name: tag_parentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "tag_parentId_idx" ON public.tag USING btree ("parentId");


--
-- Name: tag_updateId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "tag_updateId_idx" ON public.tag USING btree ("updateId");


--
-- Name: user_audit_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "user_audit_deletedAt_idx" ON public.user_audit USING btree ("deletedAt");


--
-- Name: user_clusterGroupId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "user_clusterGroupId_idx" ON public."user" USING btree ("clusterGroupId");


--
-- Name: user_updateId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "user_updateId_idx" ON public."user" USING btree ("updateId");


--
-- Name: user_updatedAt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "user_updatedAt_id_idx" ON public."user" USING btree ("updatedAt", id);


--
-- Name: video_stream_session_assetId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "video_stream_session_assetId_idx" ON public.video_stream_session USING btree ("assetId");


--
-- Name: video_stream_session_expiresAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "video_stream_session_expiresAt_idx" ON public.video_stream_session USING btree ("expiresAt");


--
-- Name: video_stream_variant_sessionId_bitrate_resolution_codec_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "video_stream_variant_sessionId_bitrate_resolution_codec_idx" ON public.video_stream_variant USING btree ("sessionId", bitrate, resolution, codec);


--
-- Name: workflow_log_workflowId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "workflow_log_workflowId_idx" ON public.workflow_log USING btree ("workflowId");


--
-- Name: workflow_log_workflowStepId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "workflow_log_workflowStepId_idx" ON public.workflow_log USING btree ("workflowStepId");


--
-- Name: workflow_ownerId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "workflow_ownerId_idx" ON public.workflow USING btree ("ownerId");


--
-- Name: workflow_step_pluginMethodId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "workflow_step_pluginMethodId_idx" ON public.workflow_step USING btree ("pluginMethodId");


--
-- Name: workflow_step_workflowId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "workflow_step_workflowId_idx" ON public.workflow_step USING btree ("workflowId");


--
-- Name: activity activity_updatedAt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "activity_updatedAt" BEFORE UPDATE ON public.activity FOR EACH ROW EXECUTE FUNCTION public.updated_at();


--
-- Name: album_asset album_asset_delete_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER album_asset_delete_audit AFTER DELETE ON public.album_asset REFERENCING OLD TABLE AS old FOR EACH STATEMENT WHEN ((pg_trigger_depth() <= 1)) EXECUTE FUNCTION public.album_asset_delete_audit();


--
-- Name: album_asset album_asset_updatedAt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "album_asset_updatedAt" BEFORE UPDATE ON public.album_asset FOR EACH ROW EXECUTE FUNCTION public.updated_at();


--
-- Name: album album_updatedAt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "album_updatedAt" BEFORE UPDATE ON public.album FOR EACH ROW EXECUTE FUNCTION public.updated_at();


--
-- Name: album_user album_user_after_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER album_user_after_insert AFTER INSERT ON public.album_user REFERENCING NEW TABLE AS inserted_rows FOR EACH STATEMENT EXECUTE FUNCTION public.album_user_after_insert();


--
-- Name: album_user album_user_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER album_user_delete AFTER DELETE ON public.album_user REFERENCING OLD TABLE AS old FOR EACH ROW EXECUTE FUNCTION public.album_user_delete();


--
-- Name: album_user album_user_delete_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER album_user_delete_audit AFTER DELETE ON public.album_user REFERENCING OLD TABLE AS old FOR EACH STATEMENT WHEN ((pg_trigger_depth() <= 1)) EXECUTE FUNCTION public.album_user_delete_audit();


--
-- Name: album_user album_user_updatedAt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "album_user_updatedAt" BEFORE UPDATE ON public.album_user FOR EACH ROW EXECUTE FUNCTION public.updated_at();


--
-- Name: api_key api_key_updatedAt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "api_key_updatedAt" BEFORE UPDATE ON public.api_key FOR EACH ROW EXECUTE FUNCTION public.updated_at();


--
-- Name: asset asset_delete_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER asset_delete_audit AFTER DELETE ON public.asset REFERENCING OLD TABLE AS old FOR EACH STATEMENT WHEN ((pg_trigger_depth() = 0)) EXECUTE FUNCTION public.asset_delete_audit();


--
-- Name: asset_edit asset_edit_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER asset_edit_audit AFTER DELETE ON public.asset_edit REFERENCING OLD TABLE AS old FOR EACH STATEMENT WHEN ((pg_trigger_depth() = 0)) EXECUTE FUNCTION public.asset_edit_audit();


--
-- Name: asset_edit asset_edit_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER asset_edit_delete AFTER DELETE ON public.asset_edit REFERENCING OLD TABLE AS deleted_edit FOR EACH STATEMENT WHEN ((pg_trigger_depth() = 0)) EXECUTE FUNCTION public.asset_edit_delete();


--
-- Name: asset_edit asset_edit_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER asset_edit_insert AFTER INSERT ON public.asset_edit REFERENCING NEW TABLE AS inserted_edit FOR EACH STATEMENT EXECUTE FUNCTION public.asset_edit_insert();


--
-- Name: asset_edit asset_edit_updatedAt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "asset_edit_updatedAt" BEFORE UPDATE ON public.asset_edit FOR EACH ROW EXECUTE FUNCTION public.updated_at();


--
-- Name: asset_exif asset_exif_updatedAt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "asset_exif_updatedAt" BEFORE UPDATE ON public.asset_exif FOR EACH ROW EXECUTE FUNCTION public.updated_at();


--
-- Name: asset_face asset_face_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER asset_face_audit AFTER DELETE ON public.asset_face REFERENCING OLD TABLE AS old FOR EACH STATEMENT WHEN ((pg_trigger_depth() = 0)) EXECUTE FUNCTION public.asset_face_audit();


--
-- Name: asset_face asset_face_set_asset_state; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER asset_face_set_asset_state BEFORE INSERT ON public.asset_face FOR EACH ROW EXECUTE FUNCTION public.asset_face_set_asset_state();


--
-- Name: asset asset_face_update_asset_state; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER asset_face_update_asset_state AFTER UPDATE ON public.asset FOR EACH ROW WHEN ((((old."ownerId" IS DISTINCT FROM new."ownerId") OR (old.visibility IS DISTINCT FROM new.visibility)) OR (old."deletedAt" IS DISTINCT FROM new."deletedAt"))) EXECUTE FUNCTION public.asset_face_update_asset_state();


--
-- Name: asset_face asset_face_updatedAt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "asset_face_updatedAt" BEFORE UPDATE ON public.asset_face FOR EACH ROW WHEN ((NOT (((old."ownerId" IS DISTINCT FROM new."ownerId") OR (old."assetVisibility" IS DISTINCT FROM new."assetVisibility")) OR (old."assetDeletedAt" IS DISTINCT FROM new."assetDeletedAt")))) EXECUTE FUNCTION public.updated_at();


--
-- Name: asset_file asset_file_updatedAt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "asset_file_updatedAt" BEFORE UPDATE ON public.asset_file FOR EACH ROW EXECUTE FUNCTION public.updated_at();


--
-- Name: asset_metadata asset_metadata_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER asset_metadata_audit AFTER DELETE ON public.asset_metadata REFERENCING OLD TABLE AS old FOR EACH STATEMENT WHEN ((pg_trigger_depth() = 0)) EXECUTE FUNCTION public.asset_metadata_audit();


--
-- Name: asset_metadata asset_metadata_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER asset_metadata_updated_at BEFORE UPDATE ON public.asset_metadata FOR EACH ROW EXECUTE FUNCTION public.updated_at();


--
-- Name: asset_ocr asset_ocr_delete_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER asset_ocr_delete_audit AFTER DELETE ON public.asset_ocr REFERENCING OLD TABLE AS old FOR EACH STATEMENT WHEN ((pg_trigger_depth() = 0)) EXECUTE FUNCTION public.asset_ocr_delete_audit();


--
-- Name: asset_ocr asset_ocr_updatedAt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "asset_ocr_updatedAt" BEFORE UPDATE ON public.asset_ocr FOR EACH ROW EXECUTE FUNCTION public.updated_at();


--
-- Name: asset asset_updatedAt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "asset_updatedAt" BEFORE UPDATE ON public.asset FOR EACH ROW EXECUTE FUNCTION public.updated_at();


--
-- Name: cluster_group cluster_group_updatedAt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "cluster_group_updatedAt" BEFORE UPDATE ON public.cluster_group FOR EACH ROW EXECUTE FUNCTION public.updated_at();


--
-- Name: library library_updatedAt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "library_updatedAt" BEFORE UPDATE ON public.library FOR EACH ROW EXECUTE FUNCTION public.updated_at();


--
-- Name: memory_asset memory_asset_delete_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER memory_asset_delete_audit AFTER DELETE ON public.memory_asset REFERENCING OLD TABLE AS old FOR EACH STATEMENT WHEN ((pg_trigger_depth() <= 1)) EXECUTE FUNCTION public.memory_asset_delete_audit();


--
-- Name: memory_asset memory_asset_updatedAt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "memory_asset_updatedAt" BEFORE UPDATE ON public.memory_asset FOR EACH ROW EXECUTE FUNCTION public.updated_at();


--
-- Name: memory memory_delete_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER memory_delete_audit AFTER DELETE ON public.memory REFERENCING OLD TABLE AS old FOR EACH STATEMENT WHEN ((pg_trigger_depth() = 0)) EXECUTE FUNCTION public.memory_delete_audit();


--
-- Name: memory memory_updatedAt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "memory_updatedAt" BEFORE UPDATE ON public.memory FOR EACH ROW EXECUTE FUNCTION public.updated_at();


--
-- Name: notification notification_updatedAt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "notification_updatedAt" BEFORE UPDATE ON public.notification FOR EACH ROW EXECUTE FUNCTION public.updated_at();


--
-- Name: partner partner_delete_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER partner_delete_audit AFTER DELETE ON public.partner REFERENCING OLD TABLE AS old FOR EACH STATEMENT WHEN ((pg_trigger_depth() = 0)) EXECUTE FUNCTION public.partner_delete_audit();


--
-- Name: partner partner_updatedAt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "partner_updatedAt" BEFORE UPDATE ON public.partner FOR EACH ROW EXECUTE FUNCTION public.updated_at();


--
-- Name: person person_delete_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER person_delete_audit AFTER DELETE ON public.person REFERENCING OLD TABLE AS old FOR EACH STATEMENT WHEN ((pg_trigger_depth() <= 1)) EXECUTE FUNCTION public.person_delete_audit();


--
-- Name: person person_delete_shares; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER person_delete_shares AFTER DELETE ON public.person REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT EXECUTE FUNCTION public.person_delete_shares();


--
-- Name: person_group person_group_delete_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER person_group_delete_audit AFTER DELETE ON public.person_group REFERENCING OLD TABLE AS old FOR EACH STATEMENT WHEN ((pg_trigger_depth() = 0)) EXECUTE FUNCTION public.person_group_delete_audit();


--
-- Name: person_group person_group_updatedAt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "person_group_updatedAt" BEFORE UPDATE ON public.person_group FOR EACH ROW EXECUTE FUNCTION public.updated_at();


--
-- Name: person person_updatedAt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "person_updatedAt" BEFORE UPDATE ON public.person FOR EACH ROW EXECUTE FUNCTION public.updated_at();


--
-- Name: person_user person_user_after_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER person_user_after_insert AFTER INSERT ON public.person_user REFERENCING NEW TABLE AS inserted_rows FOR EACH STATEMENT EXECUTE FUNCTION public.person_user_after_insert();


--
-- Name: person_user person_user_updatedAt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "person_user_updatedAt" BEFORE UPDATE ON public.person_user FOR EACH ROW EXECUTE FUNCTION public.updated_at();


--
-- Name: pixelunion_session_token pixelunion_session_token_updatedAt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "pixelunion_session_token_updatedAt" BEFORE UPDATE ON public.pixelunion_session_token FOR EACH ROW EXECUTE FUNCTION public.updated_at();


--
-- Name: session_sync_checkpoint session_sync_checkpoint_updatedAt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "session_sync_checkpoint_updatedAt" BEFORE UPDATE ON public.session_sync_checkpoint FOR EACH ROW EXECUTE FUNCTION public.updated_at();


--
-- Name: session session_updatedAt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "session_updatedAt" BEFORE UPDATE ON public.session FOR EACH ROW EXECUTE FUNCTION public.updated_at();


--
-- Name: stack stack_delete_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stack_delete_audit AFTER DELETE ON public.stack REFERENCING OLD TABLE AS old FOR EACH STATEMENT WHEN ((pg_trigger_depth() = 0)) EXECUTE FUNCTION public.stack_delete_audit();


--
-- Name: stack stack_updatedAt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "stack_updatedAt" BEFORE UPDATE ON public.stack FOR EACH ROW EXECUTE FUNCTION public.updated_at();


--
-- Name: tag tag_updatedAt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "tag_updatedAt" BEFORE UPDATE ON public.tag FOR EACH ROW EXECUTE FUNCTION public.updated_at();


--
-- Name: user user_delete_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER user_delete_audit AFTER DELETE ON public."user" REFERENCING OLD TABLE AS old FOR EACH STATEMENT WHEN ((pg_trigger_depth() = 0)) EXECUTE FUNCTION public.user_delete_audit();


--
-- Name: user_metadata user_metadata_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER user_metadata_audit AFTER DELETE ON public.user_metadata REFERENCING OLD TABLE AS old FOR EACH STATEMENT WHEN ((pg_trigger_depth() = 0)) EXECUTE FUNCTION public.user_metadata_audit();


--
-- Name: user_metadata user_metadata_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER user_metadata_updated_at BEFORE UPDATE ON public.user_metadata FOR EACH ROW EXECUTE FUNCTION public.updated_at();


--
-- Name: user user_updatedAt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "user_updatedAt" BEFORE UPDATE ON public."user" FOR EACH ROW EXECUTE FUNCTION public.updated_at();


--
-- Name: workflow workflow_updatedAt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "workflow_updatedAt" BEFORE UPDATE ON public.workflow FOR EACH ROW EXECUTE FUNCTION public.updated_at();


--
-- Name: activity activity_albumId_assetId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity
    ADD CONSTRAINT "activity_albumId_assetId_fkey" FOREIGN KEY ("albumId", "assetId") REFERENCES public.album_asset("albumId", "assetId") ON DELETE CASCADE;


--
-- Name: activity activity_albumId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity
    ADD CONSTRAINT "activity_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES public.album(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: activity activity_assetId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity
    ADD CONSTRAINT "activity_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES public.asset(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: activity activity_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity
    ADD CONSTRAINT "activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: album album_albumThumbnailAssetId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.album
    ADD CONSTRAINT "album_albumThumbnailAssetId_fkey" FOREIGN KEY ("albumThumbnailAssetId") REFERENCES public.asset(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: album_asset album_asset_albumId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.album_asset
    ADD CONSTRAINT "album_asset_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES public.album(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: album_asset album_asset_assetId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.album_asset
    ADD CONSTRAINT "album_asset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES public.asset(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: album_asset_audit album_asset_audit_albumId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.album_asset_audit
    ADD CONSTRAINT "album_asset_audit_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES public.album(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: album_user album_user_albumId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.album_user
    ADD CONSTRAINT "album_user_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES public.album(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: album_user album_user_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.album_user
    ADD CONSTRAINT "album_user_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: api_key api_key_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_key
    ADD CONSTRAINT "api_key_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: asset_audio asset_audio_assetId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_audio
    ADD CONSTRAINT "asset_audio_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES public.asset(id) ON DELETE CASCADE;


--
-- Name: asset_edit asset_edit_assetId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_edit
    ADD CONSTRAINT "asset_edit_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES public.asset(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: asset_exif asset_exif_assetId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_exif
    ADD CONSTRAINT "asset_exif_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES public.asset(id) ON DELETE CASCADE;


--
-- Name: asset_face asset_face_assetId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_face
    ADD CONSTRAINT "asset_face_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES public.asset(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: asset_face asset_face_personGroupId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_face
    ADD CONSTRAINT "asset_face_personGroupId_fkey" FOREIGN KEY ("personGroupId") REFERENCES public.person_group(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: asset_file asset_file_assetId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_file
    ADD CONSTRAINT "asset_file_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES public.asset(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: asset_job_status asset_job_status_assetId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_job_status
    ADD CONSTRAINT "asset_job_status_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES public.asset(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: asset_keyframe asset_keyframe_assetId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_keyframe
    ADD CONSTRAINT "asset_keyframe_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES public.asset(id) ON DELETE CASCADE;


--
-- Name: asset asset_libraryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset
    ADD CONSTRAINT "asset_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES public.library(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: asset asset_livePhotoVideoId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset
    ADD CONSTRAINT "asset_livePhotoVideoId_fkey" FOREIGN KEY ("livePhotoVideoId") REFERENCES public.asset(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: asset_metadata asset_metadata_assetId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_metadata
    ADD CONSTRAINT "asset_metadata_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES public.asset(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: asset_ocr asset_ocr_assetId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_ocr
    ADD CONSTRAINT "asset_ocr_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES public.asset(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: asset asset_ownerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset
    ADD CONSTRAINT "asset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: asset asset_stackId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset
    ADD CONSTRAINT "asset_stackId_fkey" FOREIGN KEY ("stackId") REFERENCES public.stack(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: asset_video asset_video_assetId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_video
    ADD CONSTRAINT "asset_video_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES public.asset(id) ON DELETE CASCADE;


--
-- Name: cluster_group_request cluster_group_request_clusterGroupId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cluster_group_request
    ADD CONSTRAINT "cluster_group_request_clusterGroupId_fkey" FOREIGN KEY ("clusterGroupId") REFERENCES public.cluster_group(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: cluster_group_request cluster_group_request_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cluster_group_request
    ADD CONSTRAINT "cluster_group_request_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: face_search face_search_faceId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.face_search
    ADD CONSTRAINT "face_search_faceId_fkey" FOREIGN KEY ("faceId") REFERENCES public.asset_face(id) ON DELETE CASCADE;


--
-- Name: integrity_report integrity_report_assetId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integrity_report
    ADD CONSTRAINT "integrity_report_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES public.asset(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: integrity_report integrity_report_fileAssetId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integrity_report
    ADD CONSTRAINT "integrity_report_fileAssetId_fkey" FOREIGN KEY ("fileAssetId") REFERENCES public.asset_file(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: library library_ownerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library
    ADD CONSTRAINT "library_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: memory_asset memory_asset_assetId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_asset
    ADD CONSTRAINT "memory_asset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES public.asset(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: memory_asset_audit memory_asset_audit_memoryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_asset_audit
    ADD CONSTRAINT "memory_asset_audit_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES public.memory(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: memory_asset memory_asset_memoriesId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_asset
    ADD CONSTRAINT "memory_asset_memoriesId_fkey" FOREIGN KEY ("memoriesId") REFERENCES public.memory(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: memory memory_ownerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory
    ADD CONSTRAINT "memory_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: notification notification_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification
    ADD CONSTRAINT "notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ocr_search ocr_search_assetId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocr_search
    ADD CONSTRAINT "ocr_search_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES public.asset(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: partner partner_sharedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner
    ADD CONSTRAINT "partner_sharedById_fkey" FOREIGN KEY ("sharedById") REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: partner partner_sharedWithId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner
    ADD CONSTRAINT "partner_sharedWithId_fkey" FOREIGN KEY ("sharedWithId") REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: person person_faceAssetId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.person
    ADD CONSTRAINT "person_faceAssetId_fkey" FOREIGN KEY ("faceAssetId") REFERENCES public.asset_face(id) ON DELETE SET NULL;


--
-- Name: person_group person_group_clusterGroupId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.person_group
    ADD CONSTRAINT "person_group_clusterGroupId_fkey" FOREIGN KEY ("clusterGroupId") REFERENCES public.cluster_group(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: person person_ownerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.person
    ADD CONSTRAINT "person_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: person person_personGroupId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.person
    ADD CONSTRAINT "person_personGroupId_fkey" FOREIGN KEY ("personGroupId") REFERENCES public.person_group(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: person_user person_user_sharedById_personGroupId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.person_user
    ADD CONSTRAINT "person_user_sharedById_personGroupId_fkey" FOREIGN KEY ("sharedById", "personGroupId") REFERENCES public.person("ownerId", "personGroupId") ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: person_user person_user_sharedWithId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.person_user
    ADD CONSTRAINT "person_user_sharedWithId_fkey" FOREIGN KEY ("sharedWithId") REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: pixelunion_session_token pixelunion_session_token_sessionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pixelunion_session_token
    ADD CONSTRAINT "pixelunion_session_token_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES public.session(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: plugin_method plugin_method_pluginId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_method
    ADD CONSTRAINT "plugin_method_pluginId_fkey" FOREIGN KEY ("pluginId") REFERENCES public.plugin(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: session session_parentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT "session_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES public.session(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: session_sync_checkpoint session_sync_checkpoint_sessionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_sync_checkpoint
    ADD CONSTRAINT "session_sync_checkpoint_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES public.session(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: session session_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: shared_link shared_link_albumId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_link
    ADD CONSTRAINT "shared_link_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES public.album(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: shared_link_asset shared_link_asset_assetId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_link_asset
    ADD CONSTRAINT "shared_link_asset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES public.asset(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: shared_link_asset shared_link_asset_sharedLinkId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_link_asset
    ADD CONSTRAINT "shared_link_asset_sharedLinkId_fkey" FOREIGN KEY ("sharedLinkId") REFERENCES public.shared_link(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: shared_link shared_link_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_link
    ADD CONSTRAINT "shared_link_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: smart_search smart_search_assetId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.smart_search
    ADD CONSTRAINT "smart_search_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES public.asset(id) ON DELETE CASCADE;


--
-- Name: stack stack_ownerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stack
    ADD CONSTRAINT "stack_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: stack stack_primaryAssetId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stack
    ADD CONSTRAINT "stack_primaryAssetId_fkey" FOREIGN KEY ("primaryAssetId") REFERENCES public.asset(id);


--
-- Name: tag_asset tag_asset_assetId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_asset
    ADD CONSTRAINT "tag_asset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES public.asset(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: tag_asset tag_asset_tagId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_asset
    ADD CONSTRAINT "tag_asset_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES public.tag(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: tag_closure tag_closure_id_ancestor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_closure
    ADD CONSTRAINT tag_closure_id_ancestor_fkey FOREIGN KEY (id_ancestor) REFERENCES public.tag(id) ON DELETE CASCADE;


--
-- Name: tag_closure tag_closure_id_descendant_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_closure
    ADD CONSTRAINT tag_closure_id_descendant_fkey FOREIGN KEY (id_descendant) REFERENCES public.tag(id) ON DELETE CASCADE;


--
-- Name: tag tag_parentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag
    ADD CONSTRAINT "tag_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES public.tag(id) ON DELETE CASCADE;


--
-- Name: tag tag_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag
    ADD CONSTRAINT "tag_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user user_clusterGroupId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT "user_clusterGroupId_fkey" FOREIGN KEY ("clusterGroupId") REFERENCES public.cluster_group(id) ON UPDATE CASCADE;


--
-- Name: user_metadata user_metadata_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_metadata
    ADD CONSTRAINT "user_metadata_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: video_stream_segment video_stream_segment_variantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_stream_segment
    ADD CONSTRAINT "video_stream_segment_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES public.video_stream_variant(id) ON DELETE CASCADE;


--
-- Name: video_stream_session video_stream_session_assetId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_stream_session
    ADD CONSTRAINT "video_stream_session_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES public.asset(id) ON DELETE CASCADE;


--
-- Name: video_stream_variant video_stream_variant_sessionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_stream_variant
    ADD CONSTRAINT "video_stream_variant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES public.video_stream_session(id) ON DELETE CASCADE;


--
-- Name: workflow_log workflow_log_workflowId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_log
    ADD CONSTRAINT "workflow_log_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES public.workflow(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: workflow_log workflow_log_workflowStepId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_log
    ADD CONSTRAINT "workflow_log_workflowStepId_fkey" FOREIGN KEY ("workflowStepId") REFERENCES public.workflow_step(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: workflow workflow_ownerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow
    ADD CONSTRAINT "workflow_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: workflow_step workflow_step_pluginMethodId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_step
    ADD CONSTRAINT "workflow_step_pluginMethodId_fkey" FOREIGN KEY ("pluginMethodId") REFERENCES public.plugin_method(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: workflow_step workflow_step_workflowId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_step
    ADD CONSTRAINT "workflow_step_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES public.workflow(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


