"""Seed the first admin user.

Usage (reads from .env by default):
    cd backend
    python -m app.cli.seed_admin

Override with CLI args:
    python -m app.cli.seed_admin --email admin@motogps.local --name Admin --password <secret>
"""

import argparse
import asyncio
import os

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

from app.config import settings
from app.auth.passwords import hash_password


async def seed_admin(email: str, name: str, password: str):
    engine = create_async_engine(settings.database_url)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with session_factory() as db:
        # Check if user already exists
        result = await db.execute(
            text("SELECT id FROM users WHERE email = :email"),
            {"email": email.lower().strip()},
        )
        existing = result.fetchone()
        if existing:
            print(f"User with email {email} already exists (id: {existing.id})")
            print("Ensuring admin flag is set...")
            await db.execute(
                text("UPDATE users SET is_admin = TRUE WHERE id = :id"),
                {"id": str(existing.id)},
            )
            await db.commit()
            admin_id = str(existing.id)
        else:
            pw_hash = hash_password(password)
            result = await db.execute(
                text(
                    "INSERT INTO users (name, email, password_hash, is_admin) "
                    "VALUES (:name, :email, :pw_hash, TRUE) "
                    "RETURNING id"
                ),
                {"name": name.strip(), "email": email.lower().strip(), "pw_hash": pw_hash},
            )
            row = result.fetchone()
            admin_id = str(row.id)
            await db.commit()
            print(f"Admin user created: {name} <{email}> (id: {admin_id})")

        # Assign orphan saved_routes and trips to the admin
        result = await db.execute(
            text("UPDATE saved_routes SET user_id = :uid WHERE user_id IS NULL"),
            {"uid": admin_id},
        )
        orphan_routes = result.rowcount
        result = await db.execute(
            text("UPDATE trips SET user_id = :uid WHERE user_id IS NULL"),
            {"uid": admin_id},
        )
        orphan_trips = result.rowcount
        await db.commit()

        if orphan_routes or orphan_trips:
            print(f"Assigned {orphan_routes} orphan routes and {orphan_trips} orphan trips to admin")

    await engine.dispose()
    print("Done!")


def main():
    parser = argparse.ArgumentParser(description="Seed the first admin user")
    parser.add_argument("--email", default=None, help="Admin email (default: ADMIN_EMAIL from .env)")
    parser.add_argument("--name", default=None, help="Admin display name (default: ADMIN_NAME from .env)")
    parser.add_argument("--password", default=None, help="Admin password (default: ADMIN_PASSWORD from .env)")
    args = parser.parse_args()

    email = args.email or os.environ.get("ADMIN_EMAIL")
    name = args.name or os.environ.get("ADMIN_NAME")
    password = args.password or os.environ.get("ADMIN_PASSWORD")

    if not email or not name or not password:
        print("Error: Admin credentials required. Set ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD")
        print("in .env file, or pass --email, --name, --password arguments.")
        return

    asyncio.run(seed_admin(email, name, password))


if __name__ == "__main__":
    main()
