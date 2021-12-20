require("dotenv").config();

const { MinPriorityQueue } = require("@datastructures-js/priority-queue");
/** Required libraries */
const mongoose = require("mongoose");
/** Database Models */
const Booking = require("./Models/booking.js");
const Dentist = require("./Models/dentist.js");

/** Import the Mqtt file which connects to the broker and provide client,as well as publishing and subscribing functions */
const mqtt = require("./Mqtt");

/**  Subscribed topics */
const checkBookingTopic = "Team5/Dentistimo/Check/Booking"; //Booking information from frontend - confirm - should include issuance
const getTimeslotTopic = "/Team5/Dentistimo/TimeSlots";

/**  Published topics */
const bookingValidatedTopic = "Team5/Dentistimo/Booking/Create/Request"; // Forward to Booking Handler
const bookingRejectedTopic = "Team5/Dentistimo/Reject/Booking"; // Forward to Frontend
const timeslotsValidatedTopic = "Team5/Dentistimo/Timeslots/Validated"; // Forward to Frontend

/** Import the database. Connection happens in the Database.js file */
const database = require("./Database");
const booking = require("./Models/booking.js");

mqtt.subscribeToTopic(checkBookingTopic); //TODO: Update to the topic from frontend
mqtt.subscribeToTopic(getTimeslotTopic);

/**  Listen to messages below */
mqtt.client.on("message", function (topic, message) {
  switch (topic) {
    case checkBookingTopic:
      bookingQueue(JSON.parse(message));
      bookingAvailability();
      break;
    case getTimeslotTopic:
      saveTimeslotsAsArray(JSON.parse(message));
      break;
    default:
      break;
  }
});

/*  Check booking Functions */
// TODO: Error handling (clinic null)
// TODO: Recieve timestamp as milliseconds
var issuanceQueue = new MinPriorityQueue({
  priority: (booking) => booking.timeStamp,
});

const bookingQueue = (booking) => {
  issuanceQueue.enqueue(booking);
};

const bookingAvailability = () => {
  //TODO: Refactor after testing
  const booking = issuanceQueue.dequeue();
  console.log(booking);
  Dentist.findById(booking.element.clinicId, function (err, dentist) {
    if (err) {
      console.error(err);
      return;
    }
    if (!dentist) {
      console.error(err);
      console.log("Dentist not found");
      return;
    }
    Booking.find(
      {
        clinic: booking.clinicId,
        date: booking.date,
        starttime: booking.time,
      },
      function (err, bookings) {
        if (err) {
          console.error(err);
          return;
        }
        const nrAvailableDentists = dentist.dentists - bookings.length;
        console.log(dentist);
        checkAvailability(nrAvailableDentists, booking.element);
      }
    );
  });
};

const checkAvailability = (nrAvailableDentists, booking) => {
  if (nrAvailableDentists > 0) {
    forwardBooking(booking);
  } else {
    rejectBooking(booking);
  }
};

// Make sure booking from frontend matches booking schema
const convertBooking = (booking) => {
  const b = new Booking();
  b.userSSN = booking.ssn;
  b.clinic = booking.clinicId;
  b.date = booking.date;
  b.startTime = booking.time;
  return b;
};

const forwardBooking = (booking) => {
  console.log(JSON.stringify(convertBooking(booking)));
  mqtt.client.publish(
    bookingValidatedTopic,
    JSON.stringify(convertBooking(booking))
  );
  console.log("Timeslot validated");
};

const rejectBooking = (booking) => {
  mqtt.client.publish(bookingRejectedTopic, JSON.stringify(booking));
  console.log("Booking rejected");
};

/* Check timeslots functions */

function saveTimeslotsAsArray(message) {
  let timeslots = message.timeSlots;
  const result = updateBreaks(timeslots);
  checkBookings(result, message.clinicId);
}

function updateBreaks(timeslots) {
  // TODO: Refactor magic numbers
  return (result = timeslots.filter(
    (item) =>
      item.start !== "12:00" &&
      item.start !== "12:30" &&
      item.start !== "10:00" &&
      item.start !== "15:00"
  ));
}

// update availability for timeslots
async function checkBookings(timeslots, clinicID) {
  console.log("check boookings, clinic: " + clinicID);

  const promises = [];
  for (let i = 0; i < timeslots.length; i++) {
    promises.push(
      Booking.find({
        clinic: mongoose.Types.ObjectId(clinicID),
        date: timeslots[i].date,
        startTime: timeslots[i].start,
      })
    );
  }
  const bookings = await Promise.all(promises);
  timeslots = filterAvailabiltyZero(timeslots, bookings);
  forwardTimeslots(timeslots, clinicID);
}

// updates availability and filters
function filterAvailabiltyZero(timeslots, bookings) {
  return (result = timeslots
    .map((timeslot, index) => {
      timeslot.available = timeslot.available - bookings[index].length;
      return timeslot;
    })
    .filter((item) => item.available > 0));
}

// Forward timeslots to frontend
function forwardTimeslots(timeslots, clinicId) {
  mqtt.client.publish(
    timeslotsValidatedTopic,
    JSON.stringify({
      timeSlots: timeslots,
      clinicId: clinicId,
    })
  );
  console.log("Validated timeslots " + timeslots);
}
