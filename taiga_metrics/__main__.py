"""Allow ``python -m taiga_metrics``."""

from __future__ import annotations

import sys

from taiga_metrics.cli import main

sys.exit(main())
