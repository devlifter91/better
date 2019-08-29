import { ApolloServer, GraphQLUpload } from "apollo-server";
import Photon from "@generated/photon";
import { nexusPrismaPlugin } from "@generated/nexus-prisma";
import { makeSchema, objectType, asNexusMethod, arg } from "@prisma/nexus";
import { join } from "path";
import { Context } from "./types";
import csv from "csvtojson";

const Upload = asNexusMethod(GraphQLUpload, "upload");

const photon = new Photon();

const nexusPrisma = nexusPrismaPlugin({
  photon: ctx => ctx.photon
});

const readFS = (stream: {
  on: (
    arg0: string,
    arg1: (data: any) => number
  ) => { on: (arg0: string, arg1: () => void) => void };
}) => {
  let chunkList: any[] | Uint8Array[] = [];
  return new Promise((resolve, reject) =>
    stream
      .on("data", data => chunkList.push(data))
      .on("end", () => resolve(Buffer.concat(chunkList)))
  );
};

const Query = objectType({
  name: "Query",
  definition(t) {
    t.crud.findOneUser();
    t.crud.findManyUser();

    t.crud.findOneCourse();
    t.crud.findManyCourse();

    // TODO: return only users that are NOT in specified Course
    t.list.field("usersNotInCourse", {
      type: User,
      args: {
        name: arg({ type: "String" })
      },
      resolve: async (root, { name }, ctx) => {
        console.log(name);

        const users = await ctx.photon.users.findMany({
          first: 10,
          where: {
            name: {
              contains: name
            }
          }
        });

        return users;
      }
    });

    t.list.field("getCoursePeople", {
      type: "User",
      args: {
        course_id: arg({ type: "String" })
      },
      resolve: async (root, { course_id }, ctx) => {
        const users = await ctx.photon.courses
          .findOne({
            where: {
              id: course_id
            }
          })
          .users();

        return users;
      }
    });
  }
});

const Mutation = objectType({
  name: "Mutation",
  definition(t) {
    t.crud.createOneUser();
    t.crud.updateOneUser();
    t.crud.deleteOneUser();
    t.crud.upsertOneUser();

    t.crud.createOneCourse();
    t.crud.updateOneCourse();
    t.crud.deleteOneCourse();
    t.crud.upsertOneCourse();

    t.field("addUserToCourse", {
      type: "User",
      args: {
        user_id: arg({ type: "ID" }),
        course_id: arg({ type: "ID" })
      },
      resolve: async (root, { user_id, course_id }, ctx) => {
        const userInCourse = await ctx.photon.users
          .findOne({
            where: { id: user_id }
          })
          .courses({
            where: {
              id: course_id
            }
          });

        if (userInCourse.length === 0) {
          const user = await ctx.photon.users.update({
            where: {
              id: user_id
            },
            data: {
              courses: {
                connect: { id: course_id }
              }
            }
          });

          return user;
        }

        return new Error("User already in course.");
      }
    });

    t.field("createCourseMessage", {
      type: CourseMessage,
      args: {
        course_id: arg({ type: "ID" }),
        message: arg({ type: "String" })
      },
      resolve: async (root, { message, course_id }, ctx) => {
        return await ctx.photon.courseMessages.create({
          data: {
            course: { connect: { id: course_id } },
            user: { connect: { id: "cjzw8d7lc000373mwlozzrhoc" } },
            message
          }
        });
      }
    });

    t.field("uploadCourseRoster", {
      type: "String",
      args: {
        file: arg({ type: "Upload" })
      },
      resolve: async (root, { file }, ctx) => {
        const { createReadStream, filename, mimetype, encoding } = await file;
        if (!filename) {
          throw Error("Invalid file Stream");
        }
        const ext = filename.split(".").pop();
        if (ext !== "csv") {
          throw Error("File not valid, must be a .csv file");
        }
        const buf = await readFS(createReadStream());
        const roster = await csv().fromString(buf.toString());

        for (const user of roster) {
          const newCourse = await ctx.photon.courses.upsert({
            where: { class_number: parseInt(user["Class Nbr"]) },
            update: {
              name: `${user.Subject} ${user["Catalog Nbr"]} ${user.Component}`,
              term: parseInt(user.Term),
              subject: user.Subject,
              catalog_number: parseInt(user["Catalog Nbr"]),
              component: user.Component,
              class_number: parseInt(user["Class Nbr"])
            },
            create: {
              name: `${user.Subject} ${user["Catalog Nbr"]} ${user.Component}`,
              term: parseInt(user.Term),
              subject: user.Subject,
              catalog_number: parseInt(user["Catalog Nbr"]),
              component: user.Component,
              class_number: parseInt(user["Class Nbr"])
            }
          });

          const newUser = await ctx.photon.users.upsert({
            where: { email: user.Email },
            update: {
              name: `${user["First Name"]} ${user.Last}`,
              email: user.Email
            },
            create: {
              name: `${user["First Name"]} ${user.Last}`,
              email: user.Email
            }
          });

          const userInCourse = await ctx.photon.users
            .findOne({
              where: { id: newUser.id }
            })
            .courses({
              where: {
                class_number: {
                  equals: newCourse.class_number
                }
              }
            });

          if (userInCourse.length === 0) {
            const linkCourse = await ctx.photon.users.update({
              where: { id: newUser.id },
              data: {
                courses: {
                  connect: { id: newCourse.id }
                }
              }
            });
          }
        }

        return "woohooo!";
      }
    });
  }
});

const User = objectType({
  name: "User",
  definition(t) {
    t.model.id();
    t.model.email();
    t.model.name();
    t.model.createdAt();
    t.model.updatedAt();
  }
});

const Course = objectType({
  name: "Course",
  definition(t) {
    t.model.id();
    t.model.name();
    t.model.title();
    t.model.class_number();
    t.model.users();
    t.model.createdAt();
    t.model.updatedAt();
  }
});

const CourseMessage = objectType({
  name: "CourseMessage",
  definition(t) {
    t.model.id();
    t.model.message();
    t.model.course();
    t.model.user();
    t.model.createdAt();
    t.model.updatedAt();
  }
});

const schema = makeSchema({
  types: [Query, Mutation, User, Course, CourseMessage, Upload, nexusPrisma],
  outputs: {
    typegen: join(__dirname, "../generated/nexus-typegen.ts"),
    schema: join(__dirname, "../generated/schema.graphql")
  },
  typegenAutoConfig: {
    sources: [
      {
        source: "@generated/photon",
        alias: "photon"
      },
      {
        source: join(__dirname, "types.ts"),
        alias: "ctx"
      }
    ],
    contextType: "ctx.Context"
  }
});

const server = new ApolloServer({
  schema,
  context: { photon }
});

server.listen().then(({ url }) => {
  console.log(`🚀 Server ready at ${url}`);
});
