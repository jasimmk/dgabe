#!/bin/bash
cd "$(dirname "$0")"
bash platform/appstore-preview.sh 2>&1 | tee make-preview.log
