# Adventure.land Bots

This is the code I use to run my bots in [AdventureLand](https://adventure.land). I use an NPM package I also made called [ALClient](https://github.com/earthiverse/alclient).

Take a look, feel free to modify it to suit your own needs, or for inspiration.

If you want to contribute to [ALClient](https://github.com/earthiverse/alclient) development, please do!

There's also a folder called `vanilla_scripts`. Those scripts are meant to be run in the main game, do not attempt to run them with ALClient.

## Docker Usage

You can run the bots using Docker for a consistent environment.

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/install/)

### Getting Started

1. **Prepare credentials**:
   Copy `credentials.json.sample` to `credentials.json` and fill in your details.
   ```bash
   cp credentials.json.sample credentials.json
   ```

2. **Run with Docker Compose**:
   ```bash
   docker-compose up --build
   ```

The bot will be accessible on port `80` (Express server) and port `8080` (GUI strategy).
