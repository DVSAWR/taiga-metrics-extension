"""Access by the new sections: Overview, Directions, Board, Cards, and People."""

from __future__ import annotations

from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None

CARD_TYPES = "array['epics', 'userstories', 'tasks', 'issues']::text[]"


def upgrade() -> None:
    """Flow metrics or a card type gives Overview and Board, Search Cards, Roles Directions."""
    op.execute(
        f"""
        update role_permission set pages = array_remove(array[
            case when pages && ({CARD_TYPES} || array['flow']) then 'overview' end,
            case when pages && {CARD_TYPES} then 'board' end,
            case when 'search' = any(pages) then 'cards' end,
            case when 'roles' = any(pages) then 'directions' end,
            case when 'people' = any(pages) then 'people' end
        ], null)
        """
    )


def downgrade() -> None:
    """Give back the old pages the new sections stand for."""
    op.execute(
        f"""
        update role_permission set pages = array_remove(array[
            case when 'overview' = any(pages) then 'flow' end,
            case when 'cards' = any(pages) then 'search' end,
            case when 'directions' = any(pages) then 'roles' end,
            case when 'people' = any(pages) then 'people' end
        ], null) || case when pages && array['overview', 'board'] then {CARD_TYPES}
                         else array[]::text[] end
        """
    )
