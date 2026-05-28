"use strict";

export default {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn("Farmers", "initData", {
      type: Sequelize.TEXT,
      allowNull: true,
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn("Farmers", "initData", {
      type: Sequelize.STRING,
      allowNull: true,
    });
  },
};
