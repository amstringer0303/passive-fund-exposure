from __future__ import annotations

import json
from pathlib import Path

from country_outline_game import MANUAL_ALIASES, country_rings, load_countries, normalize_name


OUT = Path(__file__).with_name("country_data.js")
RESOLUTION = "10m"


def rounded_ring(ring):
    return [[round(lon, 4), round(lat, 4)] for lon, lat in ring]


def main() -> int:
    countries = load_countries(RESOLUTION)
    by_name = {country.name: country for country in countries}
    extra_aliases = {country.name: set() for country in countries}

    for alias, target in MANUAL_ALIASES.items():
        if target in by_name:
            extra_aliases[target].add(alias)

    payload = []
    for country in countries:
        aliases = {normalize_name(alias) for alias in country.aliases}
        aliases.update(normalize_name(alias) for alias in extra_aliases[country.name])
        aliases.add(normalize_name(country.name))

        payload.append(
            {
                "name": country.name,
                "lon": round(country.lon, 4),
                "lat": round(country.lat, 4),
                "aliases": sorted(alias for alias in aliases if alias),
                "rings": [rounded_ring(ring) for ring in country_rings(country)],
            }
        )

    text = "window.COUNTRY_OUTLINES = "
    text += json.dumps(payload, ensure_ascii=True, separators=(",", ":"))
    text += ";\n"
    OUT.write_text(text, encoding="utf-8")
    print(f"Wrote {OUT} with {len(payload)} countries from Natural Earth {RESOLUTION}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
