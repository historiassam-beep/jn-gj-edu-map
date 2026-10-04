#!/usr/bin/env bash
# 행정동 경계(전국) → 전남·광주 읍면동·시군구·주변 시도 경계
set -e
cd "$(dirname "$0")/.."
MS="npx --yes mapshaper"
OUT=${OUT:-docs/data}
$MS raw/hjd.geojson -filter '/광주|전라남|전남/.test(sidonm)' -each 'sg=sggnm.replace(/^(광주광역시|전라남도|전남광주통합특별시)\s*/,""); sigun=(/구$/.test(sg)?"광주 ":"")+sg; emd=adm_nm.split(" ").pop(); code=adm_cd2' -filter-fields sigun,emd,code,sggnm -o work/gb_emd_full.geojson
$MS work/gb_emd_full.geojson -simplify 12% keep-shapes -filter-fields sigun,emd,code -o precision=0.0001 $OUT/emd.geojson
$MS work/gb_emd_full.geojson -dissolve sigun -simplify 10% keep-shapes -o precision=0.0001 $OUT/sigun.geojson
$MS raw/hjd.geojson -filter '!/광주|전라남|전남/.test(sidonm)' -clip bbox=124.5,33.5,128.9,36.3 -dissolve sidonm -simplify 4% keep-shapes -o precision=0.001 $OUT/neighbors.geojson
