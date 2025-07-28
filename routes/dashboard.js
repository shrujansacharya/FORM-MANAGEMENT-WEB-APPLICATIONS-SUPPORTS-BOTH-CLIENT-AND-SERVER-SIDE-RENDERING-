const express = require('express');
const router = express.Router();
const User = require('../models/User');
const axios = require('axios');

router.get('/', async (req, res) => {
  try {
    const users = await User.find();
    const totalUsers = users.length;

    const usersByYear = await User.aggregate([
      {
        $match: { createdAt: { $exists: true, $ne: null } }
      },
      {
        $group: {
          _id: { year: { $year: "$createdAt" } },
          count: { $sum: 1 }
        }
      },
      { $sort: { "_id.year": 1 } }
    ]);

    const usersOverTime = {
      labels: usersByYear.map(item => item._id.year.toString()),
      data: usersByYear.map(item => item.count)
    };

    const recentUsers = await User.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .select("name email dob contact state country createdAt validationStatus");

    res.render('dashboard', {
      totalUsers,
      usersOverTime,
      recentUsers
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.render('admin', { error: 'Error loading dashboard. Please try again.' });
  }
});

module.exports = router;