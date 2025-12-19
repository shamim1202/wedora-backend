const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const crypto = require("crypto");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const port = process.env.PORT || 3000;
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.qx9mzcm.mongodb.net/?appName=Cluster0`;
const decoder = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf-8"
);

function generateTrackingId() {
  const prefix = "WEDORA";
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const randomString = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${prefix}-${date}-${randomString}`;
}

// Firebase Admin Initialization ------------------------------>
const serviceAccount = JSON.parse(decoder);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Middleware ------------------------------------------------>
app.use(express.json());
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://wedora-event-management.web.app",
    ],
    credentials: true,
    optionsSuccessStatus: 200,
  })
);

const verifyFBToken = async (req, res, next) => {
  const token = req.headers?.authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).send({ message: "Unauthorized access" });
  }
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.decoded_email = decodedToken.email;
  } catch (error) {
    return res.status(401).send({ message: "Unauthorized access" });
  }
  next();
};

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    await client.connect();

    const db = client.db("wedoraDB");
    const usersCollection = db.collection("users");
    const servicesCollection = db.collection("services");
    const bookingsCollection = db.collection("bookings");
    const paymentsCollection = db.collection("payments");

    //===>====>=====>====> Store Services in The Database Api
    app.post("/add-service", async (req, res) => {
      const service = req.body;
      const result = await servicesCollection.insertOne(service);
      res.send(result);
    });

    //===>====>=====>====>===> Get All Services Api
    app.get("/services", async (req, res) => {
      const result = await servicesCollection.find().toArray();
      res.send(result);
    });

    //===>====>=====>====>===> Get Popular Services Api
    app.get("/top-services", async (req, res) => {
      const cursor = servicesCollection.find().limit(4);
      const result = await cursor.toArray();
      res.send(result);
    });

    //===>====>=====>====>===> Get Specific Service(id) Api
    app.get("/services/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await servicesCollection.findOne(query);
      res.send(result);
    });

    //===>====>=====>====>===> Get All Users From Database Api
    app.get("/users", async (req, res) => {
      const query = {};
      const cursor = usersCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    //===>====>=====>====>===> Added New User In The Database
    app.post("/user", async (req, res) => {
      const user = req.body;
      const result = await usersCollection.insertOne(user);
      console.log(result);
      res.send(result);
    });

    //===>====>=====> Store Booking Service In The Database Api
    app.post("/bookings", async (req, res) => {
      const booking = req.body;
      const createdAt = new Date();
      const { serviceId, date } = booking;

      const exists = await bookingsCollection.findOne({ serviceId, date });
      if (exists) {
        return res.send({
          success: false,
          message:
            "You already booked this service for same date. Please pick another date",
        });
      }
      const result = await bookingsCollection.insertOne(booking);
      res.send({
        success: true,
        message: "Booking confirmed successfully!",
        data: result,
      });
    });

    //===>====>=====>====> Get Booking Service From The Database Api
    app.get("/bookings", async (req, res) => {
      try {
        const { email } = req.query;
        const query = {};
        if (email) {
          query.userEmail = email;
        }
        const options = { sort: { createdAt: -1 } };
        const result = await bookingsCollection.find(query, options).toArray();
        res.send(result);
      } catch (error) {
        console.error("Error fetching bookings:", error);
        res.status(500).send({ error: "Failed to fetch bookings" });
      }
    });

    // ===>====>=====>====> Id Wise booking related Api
    app.get("/bookings/:bookingsId", async (req, res) => {
      const id = req.params.bookingsId;
      const query = { _id: new ObjectId(id) };
      const result = await bookingsCollection.findOne(query);
      res.send(result);
    });

    // ===>====>=====>====> Delete Booking Service From The Database Api
    app.delete("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await bookingsCollection.deleteOne(query);
      res.send(result);
    });

    //===>====>=====>====> Get Booking Date From The Database Api
    app.get("/booked-dates/:serviceId", async (req, res) => {
      const serviceId = req.params.serviceId;
      const bookings = await bookingsCollection
        .find({
          serviceId,
        })
        .project({ date: 1 })
        .toArray();

      const dates = bookings.map((b) => b.date);
      res.send(dates);
    });

    // ===>====>=====>====> Stripe Payment Intent Api
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      console.log(paymentInfo);
      const amount = parseInt(paymentInfo.cost) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "bdt",
              unit_amount: amount,
              product_data: {
                name: `Please pay for- ${paymentInfo.serviceName}`,
              },
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.userEmail,
        mode: "payment",
        metadata: {
          bookingId: paymentInfo.bookingId,
          serviceName: paymentInfo.serviceName,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?success=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });
      console.log(session);
      res.send({ url: session.url, sessionId: session.id });
    });

    // ===>====>=====>====> Stripe Payment Success Related Api
    app.patch("/payment-success", async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status !== "paid") {
        return res.send({
          success: false,
          message: "Payment not completed",
        });
      }

      const transactionId = session.payment_intent;
      const existingPayment = await paymentsCollection.findOne({
        transactionId: transactionId,
      });
      if (existingPayment) {
        return res.send({
          success: true,
          transactionId,
          trackingId: existingPayment.trackingId,
          message: "Payment already processed",
        });
      }

      const trackingId = generateTrackingId();
      const bookingId = session.metadata.bookingId;
      const query = { _id: new ObjectId(bookingId) };
      const update = {
        $set: {
          paymentStatus: "Paid",
          trackingId: trackingId,
        },
      };

      const result = await bookingsCollection.updateOne(query, update);
      const payment = {
        amount: session.amount_total / 100,
        transactionId: session.payment_intent,
        trackingId: trackingId,
        currency: session.currency,
        customerEmail: session.customer_email,
        serviceName: session.metadata.serviceName,
        paymentStatus: session.payment_status,
        bookingId: bookingId,
        paidAt: new Date(),
      };

      const paymentResult = await paymentsCollection.insertOne(payment);
      console.log("Payment record inserted:", paymentResult);
      res.send({
        success: true,
        modifyBooking: result,
        trackingId: trackingId,
        transactionId: session.payment_intent,
        paymentInfo: paymentResult,
      });
    });

    // ===>====>=====>====> Service Payment History Related Api
    app.get("/payments", verifyFBToken, async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.customerEmail = email;
        if (email !== req.decoded_email) {
          return res.status(403).send({ message: "Forbidden access" });
        }
      }
      const cursor = paymentsCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello, WEDORA - Event Management Team");
});
app.listen(port, () => {
  console.log(`WEDORA - Event Management Server Is Running On Port :`, port);
});
