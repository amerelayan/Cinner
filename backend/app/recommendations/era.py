"""Converts an era preference (onboarding's `preferred_movie_age`, or Pick
for Me's quiz answer of the same shape) into an actual TMDB release-date
range — shared by both, so "how old should it be" means the same thing and
gets enforced the same way (a real candidate filter) everywhere it's asked.
"""

from datetime import date, timedelta

ERA_YEARS_BACK = {"new": 1, "last_5_years": 5, "last_10_years": 10, "last_20_years": 20}


def era_to_date_range(era: str | None) -> tuple[str | None, str | None]:
    today = date.today()
    if era in ERA_YEARS_BACK:
        return (today - timedelta(days=365 * ERA_YEARS_BACK[era])).isoformat(), None
    if era == "25_plus_years":
        return None, (today - timedelta(days=365 * 25)).isoformat()
    return None, None  # no_preference, or unset
