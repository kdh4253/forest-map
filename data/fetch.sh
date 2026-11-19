#!/usr/bin/env bash
# 공공데이터포털 파일데이터 다운로드: ./fetch.sh <publicDataPk> <출력파일명>
# 데이터 상세 페이지에서 uddi 키를 찾아 다운로드 토큰을 받은 뒤 파일을 저장한다.
set -euo pipefail
pk="$1"; out="$2"
uddi=$(curl -s "https://www.data.go.kr/data/$pk/fileData.do" | grep -oE "fn_fileDataDown\('$pk', '[^']+'" | head -1 | sed -E "s/.*'(uddi:[^']+)'/\1/")
[ -n "$uddi" ] || { echo "uddi not found for $pk" >&2; exit 1; }
resp=$(curl -s -X POST "https://www.data.go.kr/tcs/dss/selectFileDataDownload.do" \
  --data-urlencode "publicDataDetailPk=$uddi" --data-urlencode "publicDataPk=$pk" \
  --data-urlencode "atchFileId=" --data-urlencode "fileDetailSn=1" --data-urlencode "publicDataTyCode=PR0051")
fid=$(echo "$resp" | grep -oE '"atchFileId":"FILE_[0-9]+' | head -1 | cut -d'"' -f4)
name=$(echo "$resp" | grep -oE '"orginlFileNm":"[^"]+' | head -1 | cut -d'"' -f4)
[ -n "$fid" ] || { echo "file id not found for $pk" >&2; exit 1; }
curl -s -o "$out" "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=$fid&fileDetailSn=1"
echo "$pk -> $out ($name, $(wc -c < "$out") bytes)"
