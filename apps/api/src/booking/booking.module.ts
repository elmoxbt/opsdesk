import { Module } from "@nestjs/common";
import { BookingController } from "./booking.controller";
import { BookingService } from "./booking.service";

/** `bookingPortal` feature: public booking page + booking status links. */
@Module({ controllers: [BookingController], providers: [BookingService] })
export class BookingModule {}
