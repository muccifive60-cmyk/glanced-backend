/**
* Normalize Paddle webhook payload
* → Convert Paddle-specific data to internal billing format
* (Provider-agnostic)
*/

import { upsertSubscription, cancelSubscription } from "../service.js";

/**
* Map Paddle payload → internal event
*/
export function mapPaddleEvent(payload) {
 return {
   eventType: payload.event_type,
   businessId: payload.data?.custom_data?.business_id,
   planCode: payload.data?.items?.[0]?.price?.product_id,
   subscriptionId: payload.data?.id,
   status: payload.data?.status,
 };
}

/**
* Handle Paddle event and sync with internal billing system
*/
export async function handlePaddleEvent(payload) {
 const event = mapPaddleEvent(payload);

 if (!event.businessId) {
   throw new Error("Missing business_id in Paddle payload");
 }

 switch (event.eventType) {
   case "subscription_created":
   case "subscription_updated":
     return upsertSubscription({
       businessId: event.businessId,
       planId: event.planCode,
       status: "active",
       provider: "paddle",
       providerSubscriptionId: event.subscriptionId,
     });

   case "subscription_cancelled":
   case "subscription_paused":
     return cancelSubscription(event.businessId);

   default:
     console.log("Unhandled Paddle event:", event.eventType);
     return null;
 }
}
