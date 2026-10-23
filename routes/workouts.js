'use strict';

const { Router } = require('express');

function createWorkoutsRouter({ getDatabase }) {
  const router = Router();
  router.get('/gym/catalog', async (req, res) => res.json(await getDatabase().workoutCatalog()));
  router.get('/gym/exercises', async (req, res) => res.json(await getDatabase().searchWorkoutExercises(req.query)));
  router.get('/workouts', async (req, res) => res.json(await getDatabase().listWorkouts(req.profile.id, req.query)));
  router.get('/workouts/:id', async (req, res) => res.json(await getDatabase().getWorkout(req.profile.id, req.params.id)));
  router.post('/workouts', async (req, res) => res.status(201).json(await getDatabase().saveWorkout(req.profile.id, req.body)));
  router.put('/workouts/:id', async (req, res) => res.json(await getDatabase().saveWorkout(req.profile.id, req.body, req.params.id)));
  router.delete('/workouts/:id', async (req, res) => {
    await getDatabase().deleteWorkout(req.profile.id, req.params.id, req.body?.version);
    res.status(204).end();
  });
  return router;
}

module.exports = { createWorkoutsRouter };
