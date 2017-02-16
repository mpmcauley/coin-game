/*
 * Server side game module. Maintains the game state and processes all the messages from clients.
 *
 * Exports:
 *   - addPlayer(name)
 *   - move(direction, name)
 *   - state()
 */
 const redis = require('redis'),
       client = redis.createClient();

client.on('connect', () => {
  console.log('connected');
});

const { clamp, randomPoint, permutation } = require('./gameutil');


const WIDTH = 64;
const HEIGHT = 64;
const MAX_PLAYER_NAME_LENGTH = 32;
const NUM_COINS = 100;


// A KEY-VALUE "DATABASE" FOR THE GAME STATE.
//
// The game state is maintained in an object. Your homework assignment is to swap this out
// for a Redis database.
//
// In this version, the players never die. For homework, you need to make a player die after
// five minutes of inactivity. You can use the Redis TTL for this.
//
// Here is how the storage is laid out:
//
// player:<name>    string       "<row>,<col>"
// scores           sorted set   playername with score
// coins            hash         { "<row>,<col>": coinvalue }
// usednames        set          all used names, to check quickly if a name has been used
//


const database = {
  scores: {},
  usednames: new Set(),
  coins: {},
};

exports.addPlayer = (name, callback) => {
  client.sismember('usednames', name, (err, res) => {
    if (err) {
      return callback(err);
    };
    if(name.length === 0 || name.length > MAX_PLAYER_NAME_LENGTH || res) {
      return callback(null, false);
    }
    const multiSubmit = client.multi();
    multiSubmit.sadd('usednames', name);
    multiSubmit.set(`player:${name}`, randomPoint(WIDTH, HEIGHT).toString());
    multiSubmit.zadd('scores', 0, name);
    multiSubmit.exec((err, res) => {
      if (err) {
        return callback(err);
      }
      console.log(res);
      return callback(null, !!res.reduce((sum, num) => sum && num));
    });
    return null;
  });
};


function placeCoins() {
  client.del('coins', (err) => {
    console.log(err || 'coins cleared');
    const multiSubmit = client.multi();

    permutation(WIDTH * HEIGHT).slice(0, NUM_COINS).forEach((position, i) => {
      const coinValue = (i < 50) ? 1 : (i < 75) ? 2 : (i < 95) ? 5 : 10;
      const index = `${Math.floor(position / WIDTH)},${Math.floor(position % WIDTH)}`;
      multiSubmit.hsetnx('coins', index, coinValue);
    });
    multiSubmit.exec((err, res) => console.log(err || res));
  })

}

// Return only the parts of the database relevant to the client. The client only cares about
// the positions of each player, the scores, and the positions (and values) of each coin.
// Note that we return the scores in sorted order, so the client just has to iteratively
// walk through an array of name-score pairs and render them.
exports.state = () => {
  client.keys('player:*', (err, names) => {
    if (err) {
      return err;
    }
    client.mget(names, (err, positions) => {
      if (err) {
        return err;
      }
    });
    return null;
  });
  return null;

  const positions = Object.entries(database)
    .filter(([key]) => key.startsWith('player:'))
    .map(([key, value]) => [key.substring(7), value]);
  const scores = Object.entries(database.scores);
  scores.sort(([, v1], [, v2]) => v1 < v2);
  return {
    positions,
    scores,
    coins: database.coins,
  };
};

exports.move = (direction, name) => {
  const delta = { U: [0, -1], R: [1, 0], D: [0, 1], L: [-1, 0] }[direction];
  if (delta) {
    client.get(`player:${name}`, (err, res) => {
      if (err) {
        return err;
      }
      const [x,y] = res.split(',');
      const [newX, newY] = [clamp(+x + delta[0], 0, WIDTH - 1), clamp(+y + delta[1], 0, HEIGHT - 1)];
      client.hget('coins', `${newX},${newY}`, (err, res) => {
        if (err) {
          return err;
        }
        if(res) {
          client.zincrby('scores', res, name);
          client.hdel('coins', `${newX},${newY}`);
        }
        client.set(`player:${name}`, `${newX},${newY}`);
        // When all coins collected, generate a new batch.
        client.hlen('coins', (err, res) => {
          if (err) {
            return err;
          }
          if (res === 0) {
            placeCoins();
          }
          return null;
        });
        return null;
      });
      return null;
    });
  }
};

placeCoins();
