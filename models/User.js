const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [50, 'Name cannot exceed 50 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      trim: true,
      lowercase: true,
      match: [
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        'Please enter a valid email address',
      ],
      unique: true,
      index: true,
    },
    dob: {
      type: Date,
      required: [true, 'Date of birth is required'],
      validate: {
        validator: function (value) {
          const today = new Date();
          const minDate = new Date(today.getFullYear() - 120, today.getMonth(), today.getDate());
          return value <= today && value >= minDate;
        },
        message: 'Date of birth must be valid and not in the future or more than 120 years ago',
      },
    },
    contact: {
      type: String,
      required: [true, 'Contact number is required'],
      match: [/^[0-9]{10}$/, 'Contact number must be a valid 10-digit number'],
    },
    state: {
      type: String,
      required: [true, 'State is required'],
      trim: true,
      minlength: [2, 'State must be at least 2 characters'],
      maxlength: [50, 'State cannot exceed 50 characters'],
    },
    country: {
      type: String,
      required: [true, 'Country is required'],
      trim: true,
      minlength: [2, 'Country must be at least 2 characters'],
      maxlength: [50, 'Country cannot exceed 50 characters'],
    },
    createdAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
    validationStatus: { type: String, default: null } // Added for email validation result
  },
  {
    timestamps: true,
    collection: 'users',
  }
);

// Indexes for faster queries
userSchema.index({ email: 1 });
userSchema.index({ createdAt: 1 });

// Pre-save hook for debugging and data validation
userSchema.pre('save', function (next) {
  console.log('Saving user:', {
    name: this.name,
    email: this.email,
    dob: this.dob,
    contact: this.contact,
    state: this.state,
    country: this.country,
    createdAt: this.createdAt,
    validationStatus: this.validationStatus, // Include new field in log
  });
  if (!this.createdAt || isNaN(new Date(this.createdAt).getTime())) {
    this.createdAt = new Date();
    console.warn('Invalid createdAt detected, setting to current date');
  }
  next();
});

// Handle duplicate email errors
userSchema.post('save', function (error, doc, next) {
  if (error.name === 'MongoServerError' && error.code === 11000) {
    console.error('Duplicate email error:', error.message);
    next(new Error('Email already exists'));
  } else {
    next(error);
  }
});

module.exports = mongoose.model('User', userSchema);