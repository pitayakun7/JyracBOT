const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField } = require('discord.js');
const express = require('express');

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] 
});

// --- コマンド定義 ---
const commands = [
    new SlashCommandBuilder().setName('verify').setDescription('認証パネル')
        .addRoleOption(o => o.setName('role').setDescription('付与するロール').setRequired(true))
        .addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(false))
        .addStringOption(o => o.setName('description').setDescription('説明文').setRequired(false)),
    new SlashCommandBuilder().setName('ticket').setDescription('チケットパネル')
        .addRoleOption(o => o.setName('admin-role').setDescription('管理者ロール').setRequired(true))
        .addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(false))
        .addStringOption(o => o.setName('description').setDescription('説明文').setRequired(false))
        .addStringOption(o => o.setName('panel-desc').setDescription('チケット発行後のメッセージ').setRequired(false)),
    new SlashCommandBuilder().setName('role-confirmation').setDescription('ロール確認')
        .addUserOption(o => o.setName('target').setDescription('対象のメンバー').setRequired(true))
].map(c => c.toJSON());

client.once('clientReady', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('コマンド登録完了！');
});

const app = express();
app.get('/', (req, res) => res.send('Bot is active!'));
app.listen(3000);

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'verify') {
            const role = interaction.options.getRole('role');
            const embed = new EmbedBuilder().setTitle(interaction.options.getString('title') ?? 'ロール付与').setDescription(interaction.options.getString('description') ?? '認証ボタンを押してロールを取得してください。');
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`v_role_${role.id}`).setLabel('✅認証').setStyle(ButtonStyle.Success));
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        if (interaction.commandName === 'ticket') {
            const adminRole = interaction.options.getRole('admin-role');
            const title = interaction.options.getString('title') ?? '問い合わせ';
            const description = interaction.options.getString('description') ?? 'ボタンを押してチケットを作成してください。';
            const panelDesc = Buffer.from(interaction.options.getString('panel-desc') ?? 'チケット発行ありがとうございます。担当者が来るまでしばらくお待ちください。').toString('base64');
            
            const embed = new EmbedBuilder().setTitle(title).setDescription(description);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ticket_${adminRole.id}_${panelDesc}`).setLabel('チケットを発行').setStyle(ButtonStyle.Primary));
            await interaction.reply({ embeds: [embed], components: [row] });
        }
    }

    if (interaction.isButton()) {
        if (interaction.customId.startsWith('v_role_')) {
            await interaction.member.roles.add(interaction.customId.split('_')[2]);
            await interaction.reply({ content: 'ロールを付与しました！', ephemeral: true });
        }

        if (interaction.customId.startsWith('ticket_')) {
            const [_, adminRoleId, encodedDesc] = interaction.customId.split('_');
            const panelDesc = Buffer.from(encodedDesc, 'base64').toString('utf-8');
            const adminRoleMention = `<@&${adminRoleId}>`;

            const channel = await interaction.guild.channels.create({
                name: `🎫｜${interaction.user.username}`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                    { id: adminRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                ]
            });

            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('delete_confirm').setLabel('チケット削除').setStyle(ButtonStyle.Danger));
            // 構成：メッセージ本文 \n\n 呼び出し用ロール
            await channel.send({ content: `${interaction.user} 様\n${panelDesc}\n\n${adminRoleMention}`, components: [row] });
            await interaction.reply({ content: `チケットを作成しました: ${channel}`, ephemeral: true });
        }

        if (interaction.customId === 'delete_confirm') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('delete_yes').setLabel('本当に削除する').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('delete_no').setLabel('キャンセル').setStyle(ButtonStyle.Secondary)
            );
            await interaction.reply({ content: '本当にこのチケットを削除しますか？', components: [row], ephemeral: true });
        }
        if (interaction.customId === 'delete_yes') await interaction.channel.delete();
        if (interaction.customId === 'delete_no') await interaction.update({ content: '削除をキャンセルしました。', components: [] });
    }
});

client.login(process.env.DISCORD_TOKEN);
