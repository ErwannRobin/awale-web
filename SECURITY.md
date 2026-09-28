# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for a security problem. Report it
privately through GitHub instead: go to **Security → Report a vulnerability** on
this repository.

Include what you found, how to reproduce it, and what an attacker could do with
it. You should get a reply within a week.

## Scope

The parts most worth looking at:

- **Sign-in and sessions**: the `/auth/*` routes, webhook signature checks and
  session tokens (`server/`).
- **Online play**: move validation on the server, room and seat handling.
- **Stats and leaderboard endpoints**: anything that lets one client inflate a
  rating, a profile or a nation's points.

Room codes are, by design, the only thing that authorises a player to join a
room (see [`server/README.md`](server/README.md)). Reports that rely only on
knowing a room code are expected behaviour.
