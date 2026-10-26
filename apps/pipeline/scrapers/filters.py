"""
Optional per-company scrape filters, driven by companies.json.

Two optional fields on a company entry:

  "title_keywords":    ["technician", "manufacturing", ...]
      Keep a posting only if its title contains at least one keyword
      (case-insensitive). For huge boards (SpaceX, Northrop Grumman, RTX)
      where most postings are outside our taxonomy's scope.

  "locations_include": ["TX", "Texas", "Austin", ...]
      Keep a posting only if its location text contains at least one token
      (case-insensitive). For global boards (Samsung) where we only want
      the Texas sites.

A company without these fields keeps every posting (existing behaviour).
"""


def title_passes(title: str, company: dict) -> bool:
    keywords = company.get("title_keywords")
    if not keywords:
        return True
    t = (title or "").lower()
    return any(k.lower() in t for k in keywords)


def location_passes(location_text: str, company: dict) -> bool:
    tokens = company.get("locations_include")
    if not tokens:
        return True
    loc = (location_text or "").lower()
    return any(t.lower() in loc for t in tokens)
